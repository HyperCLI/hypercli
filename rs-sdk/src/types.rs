use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use thiserror::Error;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ManagedRuntime {
    Generic,
    Openclaw,
    OpenclawPro,
    HermesAgent,
    BuzzAgent,
    Opencode,
    Codex,
    ClaudeCode,
    Goose,
    KimiCode,
}

impl ManagedRuntime {
    /// Container image owned by HyperCLI for a hosted Buzz coding runtime.
    ///
    /// Keeping this beside the shared launch contract prevents direct SDK
    /// callers and Buzz backend providers from silently choosing different
    /// images for the same runtime.
    pub const fn default_buzz_image(self) -> Option<&'static str> {
        match self {
            Self::BuzzAgent => Some("ghcr.io/hypercli/hypercli-buzz-agent:latest"),
            Self::Opencode => Some("ghcr.io/hypercli/hypercli-buzz-opencode:latest"),
            Self::Codex => Some("ghcr.io/hypercli/hypercli-buzz-codex:latest"),
            Self::ClaudeCode => Some("ghcr.io/hypercli/hypercli-buzz-claude:latest"),
            Self::Goose => Some("ghcr.io/hypercli/hypercli-buzz-goose:latest"),
            Self::KimiCode => Some("ghcr.io/hypercli/hypercli-buzz-kimi-code:latest"),
            Self::Generic | Self::Openclaw | Self::OpenclawPro | Self::HermesAgent => None,
        }
    }

    /// Runtime-owned persisted state selected by default for coding agents.
    ///
    /// `None` means the helper omits a selector and lets the launch contract
    /// use full-root sync.
    pub const fn default_sync_include(self) -> Option<&'static [&'static str]> {
        match self {
            Self::BuzzAgent => None,
            Self::Opencode => Some(&[
                ".config/opencode",
                ".local/share/opencode",
                ".local/state/opencode",
                ".cache/opencode",
            ]),
            Self::Codex => Some(&[".codex"]),
            Self::ClaudeCode => Some(&[".claude", ".claude.json"]),
            Self::Goose => Some(&[".goose"]),
            Self::KimiCode => Some(&[".kimi-code"]),
            Self::Generic | Self::Openclaw | Self::OpenclawPro | Self::HermesAgent => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentSize {
    Small,
    Medium,
    Large,
}

/// A value that is explicitly present on the wire and may be JSON `null`.
///
/// Request fields wrap this in `Option`: outer `None` means omit/inherit,
/// `Some(Nullable::Null)` means clear, and `Some(Nullable::Value(value))`
/// applies the supplied value. This keeps restart policy updates tri-state.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Nullable<T> {
    Null,
    Value(T),
}

impl<T> From<T> for Nullable<T> {
    fn from(value: T) -> Self {
        Self::Value(value)
    }
}

impl<T> Serialize for Nullable<T>
where
    T: Serialize,
{
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Null => serializer.serialize_none(),
            Self::Value(value) => value.serialize(serializer),
        }
    }
}

impl<'de, T> Deserialize<'de> for Nullable<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(match Option::<T>::deserialize(deserializer)? {
            Some(value) => Self::Value(value),
            None => Self::Null,
        })
    }
}

impl AgentSize {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Small => "small",
            Self::Medium => "medium",
            Self::Large => "large",
        }
    }
}

/// Convert a human-facing agent name into the stable DNS-safe deployment name
/// accepted by the managed-agent API. The identity suffix avoids collisions
/// without changing the display name published to chat surfaces.
pub fn canonical_deployment_name(display_name: &str, identity: &str) -> String {
    const SUFFIX_LEN: usize = 8;
    const MAX_NAME_LEN: usize = 32;

    let mut base = String::with_capacity(display_name.len());
    let mut previous_hyphen = false;
    for character in display_name.chars().flat_map(char::to_lowercase) {
        if character.is_ascii_lowercase() || character.is_ascii_digit() {
            base.push(character);
            previous_hyphen = false;
        } else if !base.is_empty() && !previous_hyphen {
            base.push('-');
            previous_hyphen = true;
        }
    }
    while base.ends_with('-') {
        base.pop();
    }
    if !base
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_lowercase())
    {
        base.insert_str(0, "buzz-");
    }
    let suffix = &identity[..identity.len().min(SUFFIX_LEN)];
    let max_base_len = MAX_NAME_LEN - suffix.len() - 1;
    base.truncate(max_base_len);
    while base.ends_with('-') {
        base.pop();
    }
    if base.len() < 2 {
        base = "buzz".to_owned();
    }
    format!("{base}-{suffix}")
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HyperAgentCanonicalPlanId {
    Solo,
    Team,
    Pro,
}

impl HyperAgentCanonicalPlanId {
    /// Parse current public IDs without rejecting free, future, or historical wire IDs.
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "solo" => Some(Self::Solo),
            "team" => Some(Self::Team),
            "pro" => Some(Self::Pro),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct AgentSlotInventory {
    #[serde(default)]
    pub granted: u32,
    #[serde(default, alias = "occupied")]
    pub used: u32,
    #[serde(default)]
    pub available: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AgentSlot {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub entitlement_id: Option<String>,
    #[serde(default)]
    pub plan_id: String,
    #[serde(default)]
    pub size: String,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub occupied: bool,
    #[serde(default)]
    pub expires_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct HyperAgentPlan {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub price: Value,
    #[serde(default)]
    pub amount_cents: u64,
    #[serde(default)]
    pub contract_version: Option<String>,
    #[serde(default)]
    pub agents: u32,
    #[serde(default)]
    pub max_agent_size: Option<AgentSize>,
    #[serde(default)]
    pub agent_resources: Option<HyperAgentPlanResources>,
    #[serde(default)]
    pub tpm_limit: u64,
    #[serde(default)]
    pub rpm_limit: u64,
    #[serde(default)]
    pub features: Vec<String>,
    #[serde(default)]
    pub models: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct HyperAgentPlanResources {
    #[serde(default)]
    pub max_agents: u32,
    #[serde(default)]
    pub total_cpu: f64,
    #[serde(default)]
    pub total_memory: f64,
}

impl HyperAgentPlan {
    pub fn canonical_id(&self) -> Option<HyperAgentCanonicalPlanId> {
        HyperAgentCanonicalPlanId::parse(&self.id)
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct HyperAgentCurrentPlan {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub price: Value,
    #[serde(default)]
    pub agents: u32,
    #[serde(default)]
    pub tpm_limit: u64,
    #[serde(default)]
    pub rpm_limit: u64,
    #[serde(default)]
    pub pooled_tpd: u64,
    #[serde(default)]
    pub slot_inventory: BTreeMap<String, AgentSlotInventory>,
    #[serde(default)]
    pub agent_slots: Vec<AgentSlot>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct HyperAgentEntitlement {
    pub id: String,
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub subscription_id: Option<String>,
    #[serde(default)]
    pub plan_id: String,
    #[serde(default)]
    pub plan_name: String,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub starts_at: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub tpm_limit: u64,
    #[serde(default)]
    pub rpm_limit: u64,
    #[serde(default)]
    pub tpd_limit: u64,
    #[serde(default)]
    pub slot_grants: BTreeMap<String, u32>,
    #[serde(default)]
    pub agent_slots: Vec<AgentSlot>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct HyperAgentEntitlementsSummary {
    #[serde(default)]
    pub effective_plan_id: String,
    #[serde(default)]
    pub pooled_tpm_limit: u64,
    #[serde(default)]
    pub pooled_rpm_limit: u64,
    #[serde(default)]
    pub pooled_tpd: u64,
    #[serde(default)]
    pub slot_inventory: BTreeMap<String, AgentSlotInventory>,
    #[serde(default)]
    pub agent_slots: Vec<AgentSlot>,
    #[serde(default)]
    pub active_subscription_count: u32,
    #[serde(default)]
    pub active_entitlement_count: u32,
    #[serde(default)]
    pub entitlement_items: Vec<HyperAgentEntitlement>,
}

impl HyperAgentEntitlementsSummary {
    /// Whether any subscription or direct entitlement is currently active.
    pub fn has_active_plan(&self) -> bool {
        self.active_subscription_count > 0 || self.active_entitlement_count > 0
    }
}

pub type EntitlementsSummary = HyperAgentEntitlementsSummary;
pub type HyperAgentSubscriptionSummary = HyperAgentEntitlementsSummary;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RouteConfig {
    pub port: u16,
    #[serde(default = "default_true")]
    pub auth: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
}

impl RouteConfig {
    pub fn new(port: u16) -> Self {
        Self {
            port,
            auth: true,
            prefix: None,
        }
    }
}

/// Default `RUST_LOG` applied to Buzz launches when the caller sets none.
///
/// Matches the Python and TypeScript SDKs' `DEFAULT_BUZZ_RUST_LOG` exactly, so
/// a fleet launched from any SDK produces the same agent log volume.
pub const DEFAULT_BUZZ_RUST_LOG: &str =
    "hyper_acp=info,buzz_acp=info,pool::prompt=info,acp::stream=off";
pub const DEFAULT_HYPER_ACP_WS_URL: &str = "wss://api.agents.hypercli.com/ws";
pub const HYPER_ACP_BUZZ_PLUGIN_COMMAND: &str = "/usr/local/lib/hyper-acp/plugins/buzz-acp";
/// Stable, non-secret resource tag applied to deployments managed by Buzz.
///
/// The per-agent `buzz_agent=<pubkey>` tag remains the identity seam. This
/// tag is deliberately independent of that identity so clients can filter a
/// fleet without parsing launch configuration or environment values.
pub const BUZZ_DEPLOYMENT_TAG: &str = "app=buzz";
/// Maximum reminders emitted when a hosted harness turn ends without publishing.
pub const BUZZ_ACP_MAX_REPLY_NAGS: u32 = 2;

/// Reminder used by HyperCLI's hosted ACP harness when a turn produced no Buzz publish.
pub const BUZZ_ACP_REPLY_GUARD_NAG: &str = "You are about to end this turn without calling `buzz messages send`. \
Your assistant text and reasoning are never shown to anyone — if you did work, found an answer, \
or hit a blocker that someone is waiting on, it exists only if you publish it. \
If you already posted, or if silence is genuinely correct for this turn, ignore this and end your turn.";

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
    "BUZZ_ACP_REQUIRE_REPLY",
    "BUZZ_AGENT_REQUIRE_REPLY",
    "CLAUDE_CODE_EXECUTABLE",
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
    "HYPER_ACP_WS_URL",
    "HYPER_ACP_AGENT_COMMAND",
    "HYPER_ACP_AGENT_ARGS",
    "HYPER_ACP_WS_LISTEN",
    "HYPER_ACP_LOG",
    "HYPER_ACP_WS_TOKEN",
    // No longer minted by the SDK; kept listed so caller-supplied values are stripped.
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
    pub require_reply: bool,
    pub session_title: Option<String>,
    pub rust_log: Option<String>,
    /// Retained for source compatibility. Hosted Buzz now always uses the raw
    /// outbound hyper-acp tunnel; the old observer route is no longer
    /// provisioned.
    pub activity: bool,
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
            require_reply: true,
            session_title: None,
            rust_log: None,
            activity: true,
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
            ManagedRuntime::BuzzAgent => (
                "/usr/local/bin/buzz-agent",
                "",
                "/usr/local/bin/buzz-dev-mcp",
            ),
            ManagedRuntime::Opencode => ("/usr/local/bin/opencode", "acp", ""),
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

        // Leave size selection to the managed-agent API. The backend owns the
        // live entitlement inventory and can choose the largest available
        // slot without baking a stale tier into a client-side contract.
        request.size = None;
        request.mark_buzz_deployment(None);
        request.command = vec!["/usr/local/bin/hyper-acp".to_owned()];
        if request.image.is_none() {
            request.image = request.runtime.default_buzz_image().map(str::to_owned);
        }
        request.routes.clear();
        request.sync_root = Some("/home/node".to_owned());
        if request.sync_include.is_none() && request.sync_exclude.is_none() {
            if let Some(paths) = request.runtime.default_sync_include() {
                request.sync_include = Some(paths.iter().map(|path| (*path).to_owned()).collect());
            } else {
                request.sync_exclude = Some(Vec::new());
            }
        }
        if request.sync_include.is_some() {
            request.sync_exclude = None;
        }
        request.sync_uid = Some(1000);
        request.sync_gid = Some(1000);
        // Hosted Buzz shutdown is process-driven; automatic restart would
        // resurrect an agent after its owner-signed `!shutdown` completes.
        request.restart = false;
        request.runtime_scopes = BUZZ_RUNTIME_SCOPES
            .iter()
            .map(|scope| (*scope).to_owned())
            .collect();
        for key in BUZZ_RESERVED_ENV {
            request.env.remove(*key);
        }
        request
            .secrets
            .insert("BUZZ_PRIVATE_KEY".to_owned(), self.private_key_nsec.clone());
        request.secrets.insert(
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
        if request.runtime == ManagedRuntime::ClaudeCode {
            request.env.insert(
                "CLAUDE_CODE_EXECUTABLE".to_owned(),
                "/usr/local/bin/claude".to_owned(),
            );
        }
        request
            .env
            .insert("BUZZ_ACP_LAZY_POOL".to_owned(), "true".to_owned());
        request
            .env
            .insert("BUZZ_ACP_RELAY_OBSERVER".to_owned(), "false".to_owned());
        request.env.insert(
            "HYPER_ACP_WS_URL".to_owned(),
            DEFAULT_HYPER_ACP_WS_URL.to_owned(),
        );
        request.env.insert(
            "HYPER_ACP_AGENT_COMMAND".to_owned(),
            HYPER_ACP_BUZZ_PLUGIN_COMMAND.to_owned(),
        );
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
        if self.require_reply {
            request
                .env
                .insert("BUZZ_ACP_REQUIRE_REPLY".to_owned(), "true".to_owned());
            request
                .env
                .insert("BUZZ_AGENT_REQUIRE_REPLY".to_owned(), "1".to_owned());
        } else {
            request
                .env
                .insert("BUZZ_AGENT_REQUIRE_REPLY".to_owned(), "0".to_owned());
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
        if let Some(model) = self
            .model
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            request
                .env
                .insert("BUZZ_ACP_MODEL".to_owned(), model.to_owned());
            let gateway = model.strip_prefix("hypercli/").unwrap_or(model);
            match request.runtime {
                ManagedRuntime::BuzzAgent => {
                    request
                        .env
                        .insert("BUZZ_AGENT_MODEL".to_owned(), gateway.to_owned());
                }
                ManagedRuntime::Goose => {
                    request
                        .env
                        .insert("GOOSE_MODEL".to_owned(), gateway.to_owned());
                }
                _ => {}
            }
        }
        insert_nonempty(
            &mut request.env,
            "BUZZ_ACP_RESPOND_TO",
            self.respond_to.as_deref().map(|value| {
                if value == "owner" {
                    "owner-only"
                } else {
                    value
                }
            }),
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

fn default_runtime_scopes() -> Vec<String> {
    BUZZ_RUNTIME_SCOPES.map(str::to_owned).to_vec()
}

#[derive(Clone, Deserialize, Serialize)]
pub struct CompleteDeploymentLaunchConfig {
    pub image: Option<String>,
    pub env: BTreeMap<String, String>,
    pub secrets: BTreeMap<String, String>,
    pub routes: BTreeMap<String, RouteConfig>,
    pub command: Vec<String>,
    pub entrypoint: Vec<String>,
    pub restart: bool,
    pub sync_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_include: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_exclude: Option<Vec<String>>,
    pub sync_uid: Option<u32>,
    pub sync_gid: Option<u32>,
    pub registry_url: Option<String>,
    pub registry_auth: BTreeMap<String, String>,
    #[serde(default = "default_runtime_scopes")]
    pub runtime_scopes: Vec<String>,
}

impl Default for CompleteDeploymentLaunchConfig {
    fn default() -> Self {
        Self {
            image: None,
            env: BTreeMap::new(),
            secrets: BTreeMap::new(),
            routes: BTreeMap::new(),
            command: Vec::new(),
            entrypoint: Vec::new(),
            restart: false,
            sync_root: None,
            sync_include: None,
            sync_exclude: None,
            sync_uid: None,
            sync_gid: None,
            registry_url: None,
            registry_auth: BTreeMap::new(),
            runtime_scopes: default_runtime_scopes(),
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
pub struct CreateDeploymentRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handle: Option<String>,
    pub runtime: ManagedRuntime,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<AgentSize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(flatten)]
    pub launch_config: CompleteDeploymentLaunchConfig,
    #[serde(default)]
    pub dry_run: bool,
}
impl std::ops::Deref for CreateDeploymentRequest {
    type Target = CompleteDeploymentLaunchConfig;
    fn deref(&self) -> &Self::Target {
        &self.launch_config
    }
}
impl std::ops::DerefMut for CreateDeploymentRequest {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.launch_config
    }
}

impl CreateDeploymentRequest {
    pub fn new(runtime: ManagedRuntime) -> Self {
        Self {
            name: None,
            handle: None,
            runtime,
            size: None,
            tags: Vec::new(),
            launch_config: CompleteDeploymentLaunchConfig::default(),
            dry_run: false,
        }
    }

    /// Mark this deployment as Buzz-managed and, when known, attach its
    /// public Nostr identity. These keys are owned by the Buzz launch
    /// contract, so stale values are replaced rather than duplicated.
    pub fn mark_buzz_deployment(&mut self, public_key: Option<&str>) {
        self.tags.retain(|tag| {
            tag != BUZZ_DEPLOYMENT_TAG
                && !tag.starts_with("app=")
                && !tag.starts_with("buzz_agent=")
        });
        self.tags.push(BUZZ_DEPLOYMENT_TAG.to_owned());
        if let Some(public_key) = public_key.map(str::trim).filter(|value| !value.is_empty()) {
            self.tags.push(format!("buzz_agent={public_key}"));
        }
    }
}

fn default_true() -> bool {
    true
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Clone, Deserialize, Serialize)]
pub struct StartDeploymentRequest {
    pub launch_config: CompleteDeploymentLaunchConfig,
    #[serde(default, skip_serializing_if = "is_false")]
    pub dry_run: bool,
}

impl StartDeploymentRequest {
    pub fn new(launch_config: CompleteDeploymentLaunchConfig) -> Self {
        Self {
            launch_config,
            dry_run: false,
        }
    }
}
impl std::ops::Deref for StartDeploymentRequest {
    type Target = CompleteDeploymentLaunchConfig;
    fn deref(&self) -> &Self::Target {
        &self.launch_config
    }
}
impl std::ops::DerefMut for StartDeploymentRequest {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.launch_config
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DeploymentRoutes {
    pub agent_id: String,
    #[serde(default)]
    pub routes: BTreeMap<String, RouteConfig>,
    #[serde(default)]
    pub cors: Option<AgentCorsConfig>,
    #[serde(default)]
    pub route_statuses: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct AgentCorsConfig {
    pub allowed_origins: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_credentials: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_headers: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_methods: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_age: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SetDeploymentRoutesRequest {
    pub routes: BTreeMap<String, RouteConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cors: Option<Nullable<AgentCorsConfig>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SetDeploymentRouteRequest {
    pub port: u16,
    pub auth: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
}

impl SetDeploymentRouteRequest {
    pub fn new(route: RouteConfig) -> Self {
        Self {
            port: route.port,
            auth: route.auth,
            prefix: route.prefix,
        }
    }
}

#[derive(Clone, Serialize)]
pub struct ExecDeploymentRequest {
    pub command: Vec<String>,
    #[serde(default = "default_exec_timeout")]
    pub timeout: u32,
    #[serde(default)]
    pub dry_run: bool,
}

impl ExecDeploymentRequest {
    pub fn new<I, S>(command: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        Self {
            command: command.into_iter().map(Into::into).collect(),
            timeout: default_exec_timeout(),
            dry_run: false,
        }
    }
}

fn default_exec_timeout() -> u32 {
    30
}

#[derive(Clone, Debug, Deserialize)]
pub struct ExecDeploymentResponse {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    #[serde(default)]
    pub dry_run: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct DeploymentFileWriteResponse {
    pub status: String,
    pub path: String,
    pub size: u64,
    #[serde(default)]
    pub target: String,
}

/// One entry in a Reef directory listing.
///
/// Reef reports directories with a trailing-slash `path` and no size; files
/// carry `size` and its human-readable rendering. Unknown fields are ignored
/// so a newer Reef can add metadata without breaking older clients.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AgentFileEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub size_formatted: Option<String>,
    #[serde(default)]
    pub last_modified: Option<String>,
}

impl AgentFileEntry {
    pub fn is_directory(&self) -> bool {
        self.entry_type == "directory"
    }

    pub fn is_file(&self) -> bool {
        self.entry_type == "file"
    }
}

/// A Reef directory listing (`GET /_reef/directories[/{path}]`).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AgentDirectoryListing {
    #[serde(rename = "type")]
    pub listing_type: String,
    #[serde(default)]
    pub prefix: String,
    #[serde(default)]
    pub directories: Vec<AgentFileEntry>,
    #[serde(default)]
    pub files: Vec<AgentFileEntry>,
    #[serde(default)]
    pub truncated: bool,
}

impl AgentDirectoryListing {
    /// Directories first, then files, matching the Python and TypeScript SDKs'
    /// `files_list`/`filesList` return order.
    pub fn into_entries(self) -> Vec<AgentFileEntry> {
        let mut entries = self.directories;
        entries.extend(self.files);
        entries
    }
}

/// Result of uploading or removing a deployment's public profile image.
///
/// Uploads return both `avatar_url` and `s3_key`; deletes return both fields as
/// `null`. The image bytes themselves are deliberately never represented in
/// this type or in HTTP traces.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DeploymentProfileImageResponse {
    pub id: String,
    pub avatar_url: Option<String>,
    pub s3_key: Option<String>,
}

/// Filters accepted by `GET /deployments`.
///
/// `query` maps to the API's `q` parameter and searches deployment IDs,
/// names, handles, pod names, and hostnames. Exact `handle` and `name`
/// filters remain separate so callers do not need to reproduce server-side
/// matching rules.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub struct DeploymentListFilters {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(rename = "q", skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_deleted: Option<bool>,
}

/// Canonical public lifecycle states understood by this SDK. Deployment state
/// remains a `String` so future server values continue to round-trip.
pub const CANONICAL_AGENT_STATES: &[&str] = &[
    "CREATING",
    "STARTING",
    "RESTORING",
    "RUNNING",
    "STOPPING",
    "STOPPED",
    "ARCHIVING",
    "ARCHIVED",
    "FAILED",
    "DELETED",
];

pub const AGENT_TRANSITIONAL_STATES: &[&str] =
    &["CREATING", "STARTING", "RESTORING", "STOPPING", "ARCHIVING"];

pub const AGENT_RUNTIME_INACTIVE_STATES: &[&str] =
    &["STOPPED", "ARCHIVING", "ARCHIVED", "FAILED", "DELETED"];

pub fn is_agent_transitional_state(state: &str) -> bool {
    AGENT_TRANSITIONAL_STATES
        .iter()
        .any(|known| state.eq_ignore_ascii_case(known))
}

pub fn is_agent_runtime_inactive_state(state: &str) -> bool {
    AGENT_RUNTIME_INACTIVE_STATES
        .iter()
        .any(|known| state.eq_ignore_ascii_case(known))
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct DeploymentMetaStatus {
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub cluster_id: Option<String>,
    #[serde(default)]
    pub namespace: Option<String>,
    #[serde(default)]
    pub observed_state: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub observed_at: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct DeploymentMeta {
    #[serde(default)]
    pub status: Option<DeploymentMetaStatus>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct Deployment {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub handle: Option<String>,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub runtime: Option<ManagedRuntime>,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub cluster_id: Option<String>,
    #[serde(default)]
    pub meta: DeploymentMeta,
    #[serde(default)]
    pub hostname: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub requested_size: Option<AgentSize>,
    #[serde(default)]
    pub archived_at: Option<String>,
    /// Independently nullable from `archived_at`: a new Agent has neither, an
    /// ARCHIVED Agent has both, and a restored Agent may carry a prefix with no
    /// `archived_at`. That tri-state is the archive contract, and it cannot be
    /// read at all if this field is dropped.
    #[serde(default)]
    pub archive_prefix: Option<String>,
    /// Set at DELETE admission. The Backend hides a soft-deleted Agent from its
    /// owner, so a client observes deletion as absence rather than by reading
    /// this back; it is the Backend's own bookkeeping for driving the evict.
    #[serde(default)]
    pub deleted_at: Option<String>,
    #[serde(default)]
    pub disconnected_at: Option<String>,
    #[serde(default)]
    pub agent_slot_id: Option<String>,
    #[serde(default)]
    pub secret_names: Vec<String>,
    #[serde(default)]
    pub launch_epoch: u64,
    /// Persisted launch settings. This can contain runtime credentials, so its
    /// `Debug` implementation is always redacted even though authenticated
    /// clients may inspect and patch individual fields deliberately.
    #[serde(default)]
    pub launch_config: DeploymentLaunchConfig,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DeploymentEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub agent_id: String,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub namespace: Option<String>,
    #[serde(default)]
    pub observed_state: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub launch_epoch: Option<u64>,
    #[serde(default)]
    pub resources_exist: Option<bool>,
    #[serde(default)]
    pub namespace_exists: Option<bool>,
    #[serde(default)]
    pub observed_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct JobLifecycleEvent {
    pub event: String,
    #[serde(default)]
    pub job_id: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub instance_id: Option<String>,
    #[serde(default)]
    pub runtime: Option<u64>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DeploymentEnvironment {
    pub agent_id: String,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub launch_epoch: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DeploymentSecretNames {
    pub agent_id: String,
    #[serde(default)]
    pub names: Vec<String>,
    #[serde(default)]
    pub launch_epoch: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DeploymentSecret {
    pub agent_id: String,
    pub key: String,
    pub value: String,
    #[serde(default)]
    pub launch_epoch: u64,
}

/// Minimal response from mutating one stored launch env key or secret.
/// Secret mutation responses never carry the value.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AgentLaunchValueMutation {
    pub agent_id: String,
    pub key: String,
    #[serde(default)]
    pub present: bool,
    #[serde(default)]
    pub launch_epoch: u64,
}

impl Deployment {
    /// True for new stable-tag deployments and legacy deployments that only
    /// carry the per-agent Buzz public-key tag.
    pub fn is_buzz_managed(&self) -> bool {
        self.tags
            .iter()
            .any(|tag| tag == BUZZ_DEPLOYMENT_TAG || tag.starts_with("buzz_agent="))
    }

    pub fn is_transitioning(&self) -> bool {
        is_agent_transitional_state(&self.state)
    }

    /// True when this deployment is cold-restorable from its verified archive.
    pub fn is_archived(&self) -> bool {
        self.state.eq_ignore_ascii_case("ARCHIVED")
    }

    /// True only for an explicitly included deletion tombstone.
    pub fn is_deleted(&self) -> bool {
        self.state.eq_ignore_ascii_case("DELETED")
    }
}

/// Persisted non-secret launch configuration returned by the agent API.
///
/// This is a redacted inspection projection, not a restart payload. Complete
/// START input must remain caller-owned because credentials are not recoverable.
#[derive(Clone, Default, Serialize)]
#[serde(transparent)]
pub struct DeploymentLaunchConfig(BTreeMap<String, Value>);

impl<'de> Deserialize<'de> for DeploymentLaunchConfig {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let mut values = BTreeMap::<String, Value>::deserialize(deserializer)?;
        values.remove("secrets");
        values.remove("registry_auth");
        Ok(Self(values))
    }
}

impl DeploymentLaunchConfig {
    pub fn as_map(&self) -> &BTreeMap<String, Value> {
        &self.0
    }

    pub fn into_map(self) -> BTreeMap<String, Value> {
        self.0
    }

    pub fn from_map(mut values: BTreeMap<String, Value>) -> Self {
        values.remove("secrets");
        values.remove("registry_auth");
        Self(values)
    }
}

impl fmt::Debug for DeploymentLaunchConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DeploymentLaunchConfig([REDACTED])")
    }
}

/// Mutable deployment fields accepted by `PATCH /deployments/{id}`.
///
/// `launch_config` is a complete replacement, not a merge patch. Fetch the
/// current deployment, modify its wrapped map, and submit the full result.
/// Secrets are persisted independently and are unaffected by this request.
#[derive(Clone, Default, Serialize)]
pub struct UpdateDeploymentRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<AgentSize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launch_config: Option<DeploymentLaunchConfig>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct DeleteDeploymentResponse {
    pub ok: bool,
    pub id: String,
    #[serde(default)]
    pub deleted_at: Option<String>,
}

/// Auth context for the configured credential (`GET /api/auth/me` on the
/// product API base). Subset of the Python SDK's `AuthMe`.
#[derive(Clone, Debug, Deserialize)]
pub struct AuthMe {
    pub user_id: String,
    #[serde(default)]
    pub team_id: String,
    #[serde(default)]
    pub plan_id: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub auth_type: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub has_active_subscription: bool,
    #[serde(default)]
    pub key_id: Option<String>,
    #[serde(default)]
    pub key_name: Option<String>,
}

/// What the presented credential is, as the agent product resolves it
/// (`GET {agents}/deployments/auth/me`).
///
/// `agent_id` is set only for an Agent runtime key, which speaks for exactly
/// one Agent; it is `None` for an owner user credential or any other key.
/// Distinct from [`AuthMe`], which is the product API's answer and never
/// reports an Agent.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct AgentAccessIdentity {
    pub user_id: String,
    #[serde(default)]
    pub auth_type: String,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub key_id: Option<String>,
    #[serde(default)]
    pub key_name: Option<String>,
    #[serde(default)]
    pub team_id: Option<String>,
    #[serde(default)]
    pub plan_id: Option<String>,
}

impl AgentAccessIdentity {
    /// True when this credential is one Agent's own runtime key.
    pub fn is_agent_runtime_key(&self) -> bool {
        self.agent_id.as_deref().is_some_and(|id| !id.is_empty())
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct CreateApiKeyRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

impl CreateApiKeyRequest {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            tags: Vec::new(),
            duration: None,
            expires_at: None,
        }
    }
}

/// A created API key. No `Debug` derive: `api_key` is the full secret and
/// is only returned on create.
#[derive(Clone, Deserialize)]
pub struct ApiKey {
    #[serde(default)]
    pub key_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub api_key_preview: Option<String>,
    #[serde(default)]
    pub last4: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub is_active: bool,
    /// Unix timestamps in fractional seconds. Deserialized tolerantly:
    /// JSON numbers and numeric strings both accepted.
    #[serde(default, deserialize_with = "de_opt_unix_ts")]
    pub created_at: Option<f64>,
    #[serde(default, deserialize_with = "de_opt_unix_ts")]
    pub expires_at: Option<f64>,
    #[serde(default, deserialize_with = "de_opt_unix_ts")]
    pub last_used_at: Option<f64>,
}

/// Accept a unix timestamp as a JSON number or a numeric string; anything
/// else becomes `None` rather than failing the whole response.
fn de_opt_unix_ts<'de, D>(deserializer: D) -> Result<Option<f64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Raw {
        Num(f64),
        Str(String),
        Other(serde::de::IgnoredAny),
    }
    Ok(match Option::<Raw>::deserialize(deserializer)? {
        Some(Raw::Num(value)) => Some(value),
        Some(Raw::Str(value)) => value.trim().parse().ok(),
        _ => None,
    })
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct AgentCapacity {
    #[serde(default)]
    pub items: Vec<Deployment>,
    #[serde(default)]
    pub total_agents: u32,
    #[serde(default)]
    pub max_agents_per_account: u32,
    #[serde(default)]
    pub running_agents: u32,
    #[serde(default)]
    pub slots: BTreeMap<String, AgentSlotInventory>,
    #[serde(default)]
    pub agent_slots: Vec<AgentSlot>,
    #[serde(default)]
    pub pooled_tpd: u64,
}

impl AgentCapacity {
    /// Select the largest currently available entitlement-backed agent shape.
    pub fn largest_available_size(&self) -> Option<AgentSize> {
        [AgentSize::Large, AgentSize::Medium, AgentSize::Small]
            .into_iter()
            .find(|size| {
                self.slots
                    .get(size.as_str())
                    .is_some_and(|slot| slot.available > 0)
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deployment_name_keeps_display_names_out_of_the_dns_contract() {
        let identity = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
        assert_eq!(
            canonical_deployment_name("CI Buzz Agent", identity),
            "ci-buzz-agent-79be667e"
        );
        assert_eq!(
            canonical_deployment_name("  42 / Very Long Agent Name With Spaces  ", identity),
            "buzz-42-very-long-agent-79be667e"
        );
        assert_eq!(canonical_deployment_name("___", identity), "buzz-79be667e");
    }

    #[test]
    fn capacity_prefers_the_largest_available_slot() {
        let capacity = AgentCapacity {
            slots: BTreeMap::from([
                (
                    "small".to_owned(),
                    AgentSlotInventory {
                        granted: 1,
                        used: 0,
                        available: 1,
                    },
                ),
                (
                    "medium".to_owned(),
                    AgentSlotInventory {
                        granted: 1,
                        used: 1,
                        available: 0,
                    },
                ),
                (
                    "large".to_owned(),
                    AgentSlotInventory {
                        granted: 2,
                        used: 1,
                        available: 1,
                    },
                ),
            ]),
            ..Default::default()
        };

        assert_eq!(capacity.largest_available_size(), Some(AgentSize::Large));
    }

    #[test]
    fn deployment_rejects_unknown_requested_size() {
        let valid: Deployment = serde_json::from_value(serde_json::json!({
            "id": "agent-1",
            "requested_size": "large"
        }))
        .unwrap();
        assert_eq!(valid.requested_size, Some(AgentSize::Large));

        assert!(serde_json::from_value::<Deployment>(serde_json::json!({
            "id": "agent-1",
            "requested_size": "huge"
        }))
        .is_err());
    }

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
            .insert("BUZZ_ACP_REQUIRE_REPLY".to_owned(), "false".to_owned());
        request.env.insert(
            "CLAUDE_CODE_EXECUTABLE".to_owned(),
            "/host/bin/claude".to_owned(),
        );
        request
            .env
            .insert("BUZZ_MANAGED_AGENT".to_owned(), "forged".to_owned());
        request.env.insert(
            "BUZZ_MANAGED_AGENT_START_NONCE".to_owned(),
            "forged".to_owned(),
        );
        request
            .env
            .insert("RUST_LOG".to_owned(), "debug".to_owned());

        let mut buzz = BuzzLaunchConfig::new("nsec1test", "wss://buzz.example.test");
        buzz.model = Some("hypercli/kimi-k2.6-anthropic".to_owned());
        buzz.parallelism = 3;
        buzz.display_name = Some("Fizz4".to_owned());
        buzz.text_mentions = true;
        buzz.require_reply = true;
        buzz.apply_to(&mut request, Some("Fizz4")).unwrap();

        assert_eq!(request.size, None);
        assert_eq!(request.tags, vec![BUZZ_DEPLOYMENT_TAG]);
        assert_eq!(request.command, vec!["/usr/local/bin/hyper-acp"]);
        assert!(!request.restart);
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
            request.env.get("HYPER_ACP_WS_URL").map(String::as_str),
            Some(DEFAULT_HYPER_ACP_WS_URL)
        );
        assert_eq!(
            request
                .env
                .get("HYPER_ACP_AGENT_COMMAND")
                .map(String::as_str),
            Some(HYPER_ACP_BUZZ_PLUGIN_COMMAND)
        );
        assert_eq!(
            request.env.get("BUZZ_ACP_AGENT_ARGS").map(String::as_str),
            Some("acp")
        );
        assert_eq!(
            request.env.get("BUZZ_ACP_MCP_COMMAND").map(String::as_str),
            Some("")
        );
        assert_eq!(
            request.env.get("BUZZ_ACP_DISPLAY_NAME").map(String::as_str),
            Some("Fizz4")
        );
        assert_eq!(request.env["BUZZ_ACP_REQUIRE_REPLY"], "true");
        assert!(!request.env.contains_key("BUZZ_PRIVATE_KEY"));
        assert!(!request.env.contains_key("NOSTR_PRIVATE_KEY"));
        assert_eq!(request.secrets["BUZZ_PRIVATE_KEY"], "nsec1test");
        assert_eq!(request.secrets["NOSTR_PRIVATE_KEY"], "nsec1test");
        assert!(!request.env.contains_key("CLAUDE_CODE_EXECUTABLE"));
        assert!(!request.env.contains_key("BUZZ_MANAGED_AGENT"));
        // The SDK no longer mints a start nonce; caller-supplied values are
        // still stripped so users cannot inject the reserved key.
        assert!(!request.env.contains_key("BUZZ_MANAGED_AGENT_START_NONCE"));
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
    fn buzz_launch_maps_model_to_runtime_native_env() {
        let mut buzz = BuzzLaunchConfig::new("nsec1test", "wss://buzz.example.test");
        buzz.model = Some("kimi-k3".to_owned());

        let mut agent_request = CreateDeploymentRequest::new(ManagedRuntime::BuzzAgent);
        buzz.apply_to(&mut agent_request, None).unwrap();
        assert_eq!(
            agent_request.env.get("BUZZ_ACP_MODEL").map(String::as_str),
            Some("kimi-k3")
        );
        assert_eq!(
            agent_request
                .env
                .get("BUZZ_AGENT_MODEL")
                .map(String::as_str),
            Some("kimi-k3")
        );

        let mut goose_request = CreateDeploymentRequest::new(ManagedRuntime::Goose);
        buzz.apply_to(&mut goose_request, None).unwrap();
        assert_eq!(
            goose_request.env.get("GOOSE_MODEL").map(String::as_str),
            Some("kimi-k3")
        );

        buzz.model = Some("hypercli/kimi-k2.6-anthropic".to_owned());
        let mut prefixed = CreateDeploymentRequest::new(ManagedRuntime::BuzzAgent);
        buzz.apply_to(&mut prefixed, None).unwrap();
        assert_eq!(
            prefixed.env.get("BUZZ_AGENT_MODEL").map(String::as_str),
            Some("kimi-k2.6-anthropic")
        );
    }

    #[test]
    fn buzz_tagging_replaces_owned_keys_and_preserves_unrelated_tags() {
        let mut request = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
        request.tags = vec![
            "team=desktop".to_owned(),
            "app=old".to_owned(),
            "buzz_agent=old-key".to_owned(),
        ];

        request.mark_buzz_deployment(Some("new-key"));

        assert_eq!(
            request.tags,
            vec![
                "team=desktop".to_owned(),
                BUZZ_DEPLOYMENT_TAG.to_owned(),
                "buzz_agent=new-key".to_owned(),
            ]
        );
    }

    #[test]
    fn deployment_recognizes_stable_and_legacy_buzz_tags() {
        let deployment = |tags: &[&str]| Deployment {
            id: "agent-1".to_owned(),
            name: "Fizz".to_owned(),
            handle: None,
            avatar_url: None,
            runtime: Some(ManagedRuntime::Opencode),
            state: "RUNNING".to_owned(),
            cluster_id: None,
            hostname: None,
            tags: tags.iter().map(|tag| (*tag).to_owned()).collect(),
            requested_size: None,
            archived_at: None,
            launch_epoch: 0,
            launch_config: Default::default(),
            ..Default::default()
        };

        assert!(deployment(&[BUZZ_DEPLOYMENT_TAG]).is_buzz_managed());
        assert!(deployment(&["buzz_agent=public-key"]).is_buzz_managed());
        assert!(!deployment(&["app=openclaw"]).is_buzz_managed());
    }

    #[test]
    fn deployment_classifies_archive_and_delete_states_without_closing_strings() {
        assert_eq!(
            CANONICAL_AGENT_STATES,
            &[
                "CREATING",
                "STARTING",
                "RESTORING",
                "RUNNING",
                "STOPPING",
                "STOPPED",
                "ARCHIVING",
                "ARCHIVED",
                "FAILED",
                "DELETED",
            ]
        );
        assert_eq!(
            AGENT_TRANSITIONAL_STATES,
            &["CREATING", "STARTING", "RESTORING", "STOPPING", "ARCHIVING"]
        );
        assert_eq!(
            AGENT_RUNTIME_INACTIVE_STATES,
            &["STOPPED", "ARCHIVING", "ARCHIVED", "FAILED", "DELETED"]
        );
        assert!(is_agent_transitional_state("archiving"));
        assert!(is_agent_runtime_inactive_state("archived"));
        assert!(!is_agent_transitional_state("future_server_state"));

        let deployment = |state: &str| Deployment {
            id: "agent-1".to_owned(),
            name: "Archive test".to_owned(),
            handle: None,
            avatar_url: None,
            runtime: None,
            state: state.to_owned(),
            cluster_id: None,
            hostname: None,
            tags: Vec::new(),
            requested_size: None,
            archived_at: None,
            launch_epoch: 0,
            launch_config: Default::default(),
            ..Default::default()
        };

        assert!(deployment("ARCHIVING").is_transitioning());
        assert!(deployment("ARCHIVED").is_archived());
        assert!(deployment("DELETED").is_deleted());

        let event: DeploymentEvent = serde_json::from_value(serde_json::json!({
            "type": "deployment.transition",
            "agent_id": "agent-1",
            "state": "ARCHIVING",
            "reason": "archive_request",
            "resources_exist": true,
            "namespace_exists": true
        }))
        .unwrap();
        assert_eq!(event.state.as_deref(), Some("ARCHIVING"));
        assert_eq!(event.resources_exist, Some(true));
        assert_eq!(event.namespace_exists, Some(true));

        let event: DeploymentEvent = serde_json::from_value(serde_json::json!({
            "type": "deployment.import_status",
            "agent_id": "agent-1",
            "status": "error",
            "namespace": "prod-agent-example",
            "reason": "missing_bound_pvc",
            "message": "PVC is absent",
            "observed_at": "2026-08-20T00:00:00Z"
        }))
        .unwrap();
        assert_eq!(event.event_type, "deployment.import_status");
        assert_eq!(event.status.as_deref(), Some("error"));
        assert_eq!(event.namespace.as_deref(), Some("prod-agent-example"));
        assert_eq!(event.reason.as_deref(), Some("missing_bound_pvc"));
    }

    #[test]
    fn deployment_deserializes_cluster_and_archive_timestamp() {
        let deployment: Deployment = serde_json::from_value(serde_json::json!({
            "id": "agent-1",
            "state": "ARCHIVED",
            "cluster_id": "cluster-current",
            "archived_at": "2026-08-09T12:00:00Z",
            "meta": {
                "other": "preserved",
                "status": {
                    "status": "error",
                    "cluster_id": "cluster-1",
                    "namespace": "prod-agent-example",
                    "observed_state": null,
                    "reason": "missing_bound_pvc",
                    "message": "bounded detail",
                    "observed_at": "2026-08-20T00:00:00Z"
                }
            }
        }))
        .unwrap();

        assert_eq!(deployment.cluster_id.as_deref(), Some("cluster-current"));
        assert_eq!(
            deployment.archived_at.as_deref(),
            Some("2026-08-09T12:00:00Z")
        );
        assert_eq!(
            deployment.meta.extra.get("other"),
            Some(&serde_json::json!("preserved"))
        );
        let meta_status = deployment.meta.status.unwrap();
        assert_eq!(meta_status.status, "error");
        assert_eq!(meta_status.cluster_id.as_deref(), Some("cluster-1"));
        assert_eq!(meta_status.reason.as_deref(), Some("missing_bound_pvc"));
    }

    #[test]
    fn deployment_deserializes_every_canonical_lifecycle_state() {
        for state in [
            "CREATING",
            "STARTING",
            "RESTORING",
            "RUNNING",
            "STOPPING",
            "STOPPED",
            "ARCHIVING",
            "ARCHIVED",
            "DELETED",
            "FAILED",
        ] {
            let deployment: Deployment = serde_json::from_value(serde_json::json!({
                "id": "agent-1",
                "state": state,
            }))
            .unwrap();

            assert_eq!(deployment.state, state);
        }
    }

    #[test]
    fn deployment_launch_config_round_trips_but_debug_is_redacted() {
        let config: DeploymentLaunchConfig = serde_json::from_value(serde_json::json!({
            "env": {"SAFE": "visible"},
            "registry_auth": {"password": "registry-secret"},
            "secrets": {"API_TOKEN": "must-not-hydrate"},
            "command": ["/usr/local/bin/hyper-acp"]
        }))
        .unwrap();

        assert_eq!(
            serde_json::to_value(&config).unwrap()["env"]["SAFE"],
            "visible"
        );
        assert!(config.as_map().get("secrets").is_none());
        let debug = format!("{config:?}");
        assert!(debug.contains("REDACTED"));
        assert!(!debug.contains("registry-secret"));
    }

    #[test]
    fn every_buzz_runtime_matches_the_shared_launch_golden() {
        let golden: serde_json::Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/buzz-launch-contract.json"
        ))
        .unwrap();
        for (runtime_name, runtime) in [
            ("buzz-agent", ManagedRuntime::BuzzAgent),
            ("opencode", ManagedRuntime::Opencode),
            ("codex", ManagedRuntime::Codex),
            ("claude-code", ManagedRuntime::ClaudeCode),
            ("goose", ManagedRuntime::Goose),
            ("kimi-code", ManagedRuntime::KimiCode),
        ] {
            let contract = &golden["runtimes"][runtime_name];
            let mut request = CreateDeploymentRequest::new(runtime);
            BuzzLaunchConfig::new("nsec1test", "wss://buzz.example.test")
                .apply_to(&mut request, None)
                .unwrap();

            assert_eq!(serde_json::to_value(runtime).unwrap(), runtime_name);
            assert_eq!(request.image.as_deref(), contract["image"].as_str());
            assert_eq!(
                request.env["BUZZ_ACP_AGENT_COMMAND"],
                contract["agent_command"]
            );
            assert_eq!(request.env["BUZZ_ACP_AGENT_ARGS"], contract["agent_args"]);
            assert_eq!(request.env["BUZZ_ACP_MCP_COMMAND"], contract["mcp_command"]);
            for (key, value) in golden["common_env"].as_object().unwrap() {
                assert_eq!(request.env.get(key).map(String::as_str), value.as_str());
            }
            let expected_env = contract["env"].as_object().unwrap();
            for (key, value) in expected_env {
                assert_eq!(request.env.get(key).map(String::as_str), value.as_str());
            }
            if contract.get("sync_include").is_some() {
                assert_eq!(
                    serde_json::to_value(&request.sync_include).unwrap(),
                    contract["sync_include"]
                );
                assert_eq!(request.sync_exclude, None);
            } else {
                assert_eq!(
                    serde_json::to_value(&request.sync_exclude).unwrap(),
                    contract["sync_exclude"]
                );
                assert_eq!(request.sync_include, None);
            }
            assert_eq!(
                request
                    .env
                    .get("CLAUDE_CODE_EXECUTABLE")
                    .map(String::as_str),
                contract["claude_code_executable"].as_str()
            );
        }
    }

    #[test]
    fn coding_runtime_sync_defaults_and_overrides_are_flat() {
        for (runtime, expected) in [
            (ManagedRuntime::BuzzAgent, vec![]),
            (
                ManagedRuntime::Opencode,
                vec![
                    ".config/opencode",
                    ".local/share/opencode",
                    ".local/state/opencode",
                    ".cache/opencode",
                ],
            ),
            (ManagedRuntime::Codex, vec![".codex"]),
            (ManagedRuntime::ClaudeCode, vec![".claude", ".claude.json"]),
            (ManagedRuntime::Goose, vec![".goose"]),
            (ManagedRuntime::KimiCode, vec![".kimi-code"]),
        ] {
            let mut request = CreateDeploymentRequest::new(runtime);
            BuzzLaunchConfig::new("nsec1test", "wss://buzz.example.test")
                .apply_to(&mut request, None)
                .unwrap();
            if runtime == ManagedRuntime::BuzzAgent {
                assert_eq!(request.sync_include, None);
                assert_eq!(request.sync_exclude, Some(Vec::new()));
            } else {
                assert_eq!(
                    request.sync_include,
                    Some(expected.into_iter().map(str::to_owned).collect())
                );
                assert_eq!(request.sync_exclude, None);
            }
        }

        let mut custom = CreateDeploymentRequest::new(ManagedRuntime::Codex);
        custom.sync_include = Some(vec!["work".to_owned()]);
        custom.sync_exclude = Some(vec!["tmp".to_owned()]);
        BuzzLaunchConfig::new("nsec1test", "wss://buzz.example.test")
            .apply_to(&mut custom, None)
            .unwrap();
        assert_eq!(custom.sync_include, Some(vec!["work".to_owned()]));
        assert_eq!(custom.sync_exclude, None);
    }

    #[test]
    fn empty_sync_exclude_round_trips_as_full_root_sync() {
        let full_root = StartDeploymentRequest::new(CompleteDeploymentLaunchConfig {
            sync_exclude: Some(Vec::new()),
            ..Default::default()
        });
        let full_root_wire = serde_json::to_value(&full_root).unwrap();
        assert!(full_root_wire["launch_config"]
            .get("sync_include")
            .is_none());
        assert_eq!(
            full_root_wire["launch_config"]["sync_exclude"],
            serde_json::json!([])
        );
        let full_root_round_trip: StartDeploymentRequest =
            serde_json::from_value(full_root_wire).unwrap();
        assert_eq!(full_root_round_trip.sync_include, None);
        assert_eq!(full_root_round_trip.sync_exclude, Some(Vec::new()));

        let launch = CompleteDeploymentLaunchConfig {
            sync_exclude: Some(vec!["tmp/**".into()]),
            ..Default::default()
        };
        let excluded = StartDeploymentRequest::new(launch);
        let excluded_wire = serde_json::to_value(&excluded).unwrap();
        assert_eq!(
            excluded_wire["launch_config"]["sync_exclude"],
            serde_json::json!(["tmp/**"])
        );
    }

    #[test]
    fn create_request_has_no_start_field() {
        let request = CreateDeploymentRequest::new(ManagedRuntime::Openclaw);
        let wire = serde_json::to_value(request).unwrap();
        assert!(wire.get("start").is_none());
    }

    #[test]
    fn buzz_launch_canonicalizes_the_legacy_owner_policy() {
        let mut request = CreateDeploymentRequest::new(ManagedRuntime::BuzzAgent);
        let mut buzz = BuzzLaunchConfig::new("nsec1test", "wss://buzz.example.test");
        buzz.respond_to = Some("owner".to_owned());

        buzz.apply_to(&mut request, None).unwrap();

        assert_eq!(request.env["BUZZ_ACP_RESPOND_TO"], "owner-only");
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
    fn buzz_launch_respects_an_explicit_image_override() {
        let mut request = CreateDeploymentRequest::new(ManagedRuntime::BuzzAgent);
        request.image = Some("registry.example.test/custom-buzz:sha".to_owned());

        BuzzLaunchConfig::new("nsec1test", "wss://buzz.example.test")
            .apply_to(&mut request, None)
            .unwrap();

        assert_eq!(
            request.image.as_deref(),
            Some("registry.example.test/custom-buzz:sha")
        );
    }

    #[test]
    fn buzz_launch_rederives_claude_executable_inside_the_image() {
        let mut request = CreateDeploymentRequest::new(ManagedRuntime::ClaudeCode);
        request.env.insert(
            "CLAUDE_CODE_EXECUTABLE".to_owned(),
            "/host/bin/claude".to_owned(),
        );
        let buzz = BuzzLaunchConfig::new("nsec1test", "wss://buzz.example.test");

        buzz.apply_to(&mut request, None).unwrap();

        assert_eq!(
            request.env["CLAUDE_CODE_EXECUTABLE"],
            "/usr/local/bin/claude"
        );
    }

    #[test]
    fn buzz_launch_uses_raw_outbound_hyper_acp_by_default() {
        let mut request = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
        BuzzLaunchConfig::new("nsec1test", "wss://buzz.example.test")
            .apply_to(&mut request, None)
            .unwrap();

        assert_eq!(
            request.env.get("HYPER_ACP_WS_URL").map(String::as_str),
            Some(DEFAULT_HYPER_ACP_WS_URL)
        );
        assert_eq!(
            request
                .env
                .get("HYPER_ACP_AGENT_COMMAND")
                .map(String::as_str),
            Some(HYPER_ACP_BUZZ_PLUGIN_COMMAND)
        );
        assert_eq!(
            request
                .env
                .get("BUZZ_ACP_RELAY_OBSERVER")
                .map(String::as_str),
            Some("false")
        );
        assert!(!request.env.contains_key("HYPER_ACP_WS_LISTEN"));
        assert!(!request.env.contains_key("HYPER_ACP_LOG"));
        assert!(!request.routes.contains_key("hyper-acp"));
        assert!(!request.secrets.contains_key("HYPER_ACP_WS_TOKEN"));
    }

    #[test]
    fn buzz_launch_activity_flag_does_not_reenable_observer_route() {
        let mut request = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
        let mut buzz = BuzzLaunchConfig::new("nsec1test", "wss://buzz.example.test");
        buzz.activity = false;
        buzz.apply_to(&mut request, None).unwrap();
        assert_eq!(
            request.env.get("HYPER_ACP_WS_URL").map(String::as_str),
            Some(DEFAULT_HYPER_ACP_WS_URL)
        );
        assert_eq!(
            request
                .env
                .get("HYPER_ACP_AGENT_COMMAND")
                .map(String::as_str),
            Some(HYPER_ACP_BUZZ_PLUGIN_COMMAND)
        );
        assert!(!request.env.contains_key("HYPER_ACP_WS_LISTEN"));
        assert!(!request.env.contains_key("HYPER_ACP_LOG"));
        assert!(!request.routes.contains_key("hyper-acp"));
        assert!(!request.secrets.contains_key("HYPER_ACP_WS_TOKEN"));
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
            Some("hyper_acp=info,buzz_acp=info,pool::prompt=info,acp::stream=off")
        );
    }

    #[test]
    fn complete_launch_serializes_explicit_restart_policy() {
        let generic = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
        let generic_json = serde_json::to_value(&generic).unwrap();
        assert_eq!(generic_json["restart"], false);
        assert!(generic_json.get("config").is_none());
        let generic_start = StartDeploymentRequest::new(generic.launch_config.clone());
        let generic_start_json = serde_json::to_value(&generic_start).unwrap();
        assert_eq!(generic_start_json["launch_config"]["restart"], false);
        assert!(generic_start_json["launch_config"].get("config").is_none());

        let mut buzz_request = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
        buzz_request.restart = true;
        BuzzLaunchConfig::new("nsec1test", "wss://buzz.example.test")
            .apply_to(&mut buzz_request, None)
            .unwrap();
        assert_eq!(
            serde_json::to_value(&buzz_request).unwrap()["restart"],
            false
        );
        let round_trip: CreateDeploymentRequest =
            serde_json::from_value(serde_json::to_value(&buzz_request).unwrap()).unwrap();
        assert!(!round_trip.restart);

        let start = StartDeploymentRequest::new(buzz_request.launch_config);
        let start_json = serde_json::to_value(&start).unwrap();
        assert!(start_json["launch_config"].get("config").is_none());
        let start_round_trip: StartDeploymentRequest = serde_json::from_value(start_json).unwrap();
        assert!(!start_round_trip.restart);
    }

    #[test]
    fn complete_launch_defaults_to_the_backend_full_runtime_scope_set() {
        let create = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
        let create_json = serde_json::to_value(&create).unwrap();
        let expected = BUZZ_RUNTIME_SCOPES.map(str::to_owned);
        assert_eq!(create_json["runtime_scopes"], serde_json::json!(expected));

        let start = StartDeploymentRequest::new(create.launch_config.clone());
        let start_json = serde_json::to_value(&start).unwrap();
        assert_eq!(
            start_json["launch_config"]["runtime_scopes"],
            serde_json::json!(expected)
        );

        let mut create = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
        create.runtime_scopes = vec!["agents:none".to_owned(), "models:*".to_owned()];
        assert_eq!(
            serde_json::to_value(&create).unwrap()["runtime_scopes"],
            serde_json::json!(["agents:none", "models:*"])
        );

        let start = StartDeploymentRequest::new(create.launch_config.clone());
        assert_eq!(
            serde_json::to_value(&start).unwrap()["launch_config"]["runtime_scopes"],
            serde_json::json!(["agents:none", "models:*"])
        );
    }
}
