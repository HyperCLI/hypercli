//! Native-only Buzz connection and enrollment primitives.
//!
//! Owner keys intentionally stop at this module boundary. The webview receives
//! [`BuzzConnectionMetadata`] and [`OwnerIdentity`], never an `nsec`, raw secret
//! key, or NIP-OA credential. Relay transport is deliberately separate: the
//! pure event builders here make the signed wire shape easy to test and audit.

use nostr::hashes::{sha256, Hash};
use nostr::secp256k1::{schnorr::Signature, Message};
use nostr::{Event, EventBuilder, Keys, Kind, PublicKey, RelayUrl, Tag, ToBech32, SECP256K1};
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::fmt;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use uuid::Uuid;

const DOCUMENT_VERSION: u32 = 1;
const KEYCHAIN_SERVICE: &str = "com.hypercli.desktop.buzz-owner";
const MAX_DOCUMENT_BYTES: u64 = 1024 * 1024;

#[derive(Debug)]
pub enum BuzzConnectionError {
    InvalidInput(String),
    InvalidStoredMetadata(String),
    Io(std::io::Error),
    Json(serde_json::Error),
    SecureStorageUnavailable,
    SecretNotFound,
}

impl fmt::Display for BuzzConnectionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInput(message) => write!(f, "{message}"),
            Self::InvalidStoredMetadata(message) => {
                write!(f, "invalid stored Buzz connection metadata: {message}")
            }
            Self::Io(error) => write!(f, "Buzz connection storage failed: {error}"),
            Self::Json(error) => write!(f, "Buzz connection metadata is invalid JSON: {error}"),
            Self::SecureStorageUnavailable => {
                write!(f, "the OS secure credential store is unavailable")
            }
            Self::SecretNotFound => write!(f, "the Buzz owner credential is unavailable"),
        }
    }
}

impl std::error::Error for BuzzConnectionError {}

impl From<std::io::Error> for BuzzConnectionError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

impl From<serde_json::Error> for BuzzConnectionError {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}

/// A validated owner secret. It is deliberately neither `Debug` nor
/// `Serialize`; callers can only derive public identity from it.
pub struct OwnerNsec(SecretString);

impl OwnerNsec {
    pub fn parse(value: &str) -> Result<Self, BuzzConnectionError> {
        let trimmed = value.trim();
        if !trimmed.starts_with("nsec1") {
            return Err(BuzzConnectionError::InvalidInput(
                "Buzz owner identity must be an nsec".into(),
            ));
        }
        let keys = Keys::parse(trimmed)
            .map_err(|_| BuzzConnectionError::InvalidInput("Buzz owner nsec is invalid".into()))?;
        let canonical = keys
            .secret_key()
            .to_bech32()
            .map_err(|_| BuzzConnectionError::InvalidInput("Buzz owner nsec is invalid".into()))?;
        Ok(Self(SecretString::from(canonical)))
    }

    pub fn identity(&self) -> Result<OwnerIdentity, BuzzConnectionError> {
        let keys = self.keys()?;
        OwnerIdentity::from_public_key(keys.public_key())
    }

    fn keys(&self) -> Result<Keys, BuzzConnectionError> {
        Keys::parse(self.0.expose_secret()).map_err(|_| {
            BuzzConnectionError::InvalidStoredMetadata(
                "owner credential in secure storage is invalid".into(),
            )
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OwnerIdentity {
    pub public_hex: String,
    pub npub: String,
}

impl OwnerIdentity {
    fn from_public_key(public_key: PublicKey) -> Result<Self, BuzzConnectionError> {
        Ok(Self {
            public_hex: public_key.to_hex(),
            npub: public_key.to_bech32().map_err(|_| {
                BuzzConnectionError::InvalidInput("could not encode owner npub".into())
            })?,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BuzzConnectionMetadata {
    pub id: String,
    pub label: String,
    pub relay_url: String,
    pub owner_public_hex: String,
    pub owner_npub: String,
    /// An opaque account name within HyperCLI's private keychain service.
    pub keychain_ref: String,
}

impl BuzzConnectionMetadata {
    pub fn new(
        label: &str,
        relay_url: &str,
        owner: &OwnerIdentity,
    ) -> Result<Self, BuzzConnectionError> {
        let id = Uuid::new_v4().to_string();
        let metadata = Self {
            keychain_ref: format!("buzz-owner/{id}"),
            id,
            label: normalize_label(label)?,
            relay_url: canonical_relay_url(relay_url)?,
            owner_public_hex: owner.public_hex.clone(),
            owner_npub: owner.npub.clone(),
        };
        metadata.validate()?;
        Ok(metadata)
    }

    fn validate(&self) -> Result<(), BuzzConnectionError> {
        let id = Uuid::parse_str(&self.id).map_err(|_| {
            BuzzConnectionError::InvalidStoredMetadata("connection id is not a UUID".into())
        })?;
        if self.keychain_ref != format!("buzz-owner/{id}") {
            return Err(BuzzConnectionError::InvalidStoredMetadata(
                "keychain reference does not match the connection id".into(),
            ));
        }
        normalize_label(&self.label)
            .map_err(|error| BuzzConnectionError::InvalidStoredMetadata(error.to_string()))?;
        let canonical = canonical_relay_url(&self.relay_url)
            .map_err(|error| BuzzConnectionError::InvalidStoredMetadata(error.to_string()))?;
        if canonical != self.relay_url {
            return Err(BuzzConnectionError::InvalidStoredMetadata(
                "relay URL is not canonical".into(),
            ));
        }
        let public_key = parse_public_key_hex(&self.owner_public_hex)?;
        let identity = OwnerIdentity::from_public_key(public_key)?;
        if identity.npub != self.owner_npub {
            return Err(BuzzConnectionError::InvalidStoredMetadata(
                "owner npub does not match owner public key".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChannelReference {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManagedBuzzAgentMetadata {
    pub agent_public_hex: String,
    pub agent_npub: String,
    pub connection_id: String,
    pub channels: Vec<ChannelReference>,
    pub deployment_id: Option<String>,
    pub runtime: String,
    #[serde(default)]
    pub tags: BTreeMap<String, String>,
}

impl ManagedBuzzAgentMetadata {
    fn validate(&self) -> Result<(), BuzzConnectionError> {
        let agent = parse_public_key_hex(&self.agent_public_hex)?;
        if agent.to_bech32().map_err(|_| {
            BuzzConnectionError::InvalidStoredMetadata("could not encode agent npub".into())
        })? != self.agent_npub
        {
            return Err(BuzzConnectionError::InvalidStoredMetadata(
                "agent npub does not match agent public key".into(),
            ));
        }
        Uuid::parse_str(&self.connection_id).map_err(|_| {
            BuzzConnectionError::InvalidStoredMetadata("agent connection id is invalid".into())
        })?;
        if let Some(deployment_id) = &self.deployment_id {
            Uuid::parse_str(deployment_id).map_err(|_| {
                BuzzConnectionError::InvalidStoredMetadata("deployment id is invalid".into())
            })?;
        }
        const RUNTIMES: &[&str] = &[
            "buzz-agent",
            "opencode",
            "goose",
            "claude-code",
            "codex",
            "kimi-code",
        ];
        if !RUNTIMES.contains(&self.runtime.as_str()) {
            return Err(BuzzConnectionError::InvalidStoredMetadata(
                "agent runtime is not recognized".into(),
            ));
        }
        for channel in &self.channels {
            Uuid::parse_str(&channel.id).map_err(|_| {
                BuzzConnectionError::InvalidStoredMetadata("channel id is invalid".into())
            })?;
            if channel.name.trim().is_empty() || channel.name.len() > 120 {
                return Err(BuzzConnectionError::InvalidStoredMetadata(
                    "channel name is invalid".into(),
                ));
            }
        }
        for (key, value) in &self.tags {
            if key.is_empty() || key.len() > 64 || value.len() > 256 || is_secret_field_name(key) {
                return Err(BuzzConnectionError::InvalidStoredMetadata(
                    "agent product tag is invalid".into(),
                ));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BuzzConnectionsDocument {
    pub version: u32,
    #[serde(default)]
    pub connections: Vec<BuzzConnectionMetadata>,
    #[serde(default)]
    pub agents: Vec<ManagedBuzzAgentMetadata>,
}

impl Default for BuzzConnectionsDocument {
    fn default() -> Self {
        Self {
            version: DOCUMENT_VERSION,
            connections: Vec::new(),
            agents: Vec::new(),
        }
    }
}

impl BuzzConnectionsDocument {
    fn validate(&self) -> Result<(), BuzzConnectionError> {
        if self.version != DOCUMENT_VERSION {
            return Err(BuzzConnectionError::InvalidStoredMetadata(format!(
                "unsupported document version {}",
                self.version
            )));
        }
        let mut ids = std::collections::HashSet::new();
        for connection in &self.connections {
            connection.validate()?;
            if !ids.insert(connection.id.as_str()) {
                return Err(BuzzConnectionError::InvalidStoredMetadata(
                    "duplicate connection id".into(),
                ));
            }
        }
        let mut agent_pubkeys = std::collections::HashSet::new();
        for agent in &self.agents {
            agent.validate()?;
            if !ids.contains(agent.connection_id.as_str()) {
                return Err(BuzzConnectionError::InvalidStoredMetadata(
                    "agent references an unknown connection".into(),
                ));
            }
            if !agent_pubkeys.insert(agent.agent_public_hex.as_str()) {
                return Err(BuzzConnectionError::InvalidStoredMetadata(
                    "duplicate managed agent public key".into(),
                ));
            }
        }
        Ok(())
    }
}

/// Abstracts the OS keychain so persistence behavior can be tested without
/// touching a developer's real credentials.
pub trait OwnerSecretStore: Send + Sync {
    fn store(&self, keychain_ref: &str, nsec: &OwnerNsec) -> Result<(), BuzzConnectionError>;
    fn load(&self, keychain_ref: &str) -> Result<Option<OwnerNsec>, BuzzConnectionError>;
    fn delete(&self, keychain_ref: &str) -> Result<(), BuzzConnectionError>;
}

pub struct SystemOwnerSecretStore;

impl SystemOwnerSecretStore {
    pub fn new() -> Self {
        Self
    }

    fn entry(keychain_ref: &str) -> Result<keyring::Entry, BuzzConnectionError> {
        validate_keychain_ref(keychain_ref)?;
        keyring::Entry::new(KEYCHAIN_SERVICE, keychain_ref)
            .map_err(|_| BuzzConnectionError::SecureStorageUnavailable)
    }
}

impl Default for SystemOwnerSecretStore {
    fn default() -> Self {
        Self::new()
    }
}

impl OwnerSecretStore for SystemOwnerSecretStore {
    fn store(&self, keychain_ref: &str, nsec: &OwnerNsec) -> Result<(), BuzzConnectionError> {
        Self::entry(keychain_ref)?
            .set_password(nsec.0.expose_secret())
            .map_err(|_| BuzzConnectionError::SecureStorageUnavailable)
    }

    fn load(&self, keychain_ref: &str) -> Result<Option<OwnerNsec>, BuzzConnectionError> {
        match Self::entry(keychain_ref)?.get_password() {
            Ok(value) => OwnerNsec::parse(&value).map(Some).map_err(|_| {
                BuzzConnectionError::InvalidStoredMetadata(
                    "owner credential in secure storage is invalid".into(),
                )
            }),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(BuzzConnectionError::SecureStorageUnavailable),
        }
    }

    fn delete(&self, keychain_ref: &str) -> Result<(), BuzzConnectionError> {
        match Self::entry(keychain_ref)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(BuzzConnectionError::SecureStorageUnavailable),
        }
    }
}

/// Owns the ordering between nonsecret JSON metadata and OS-keychain writes.
pub struct BuzzConnectionRepository<S> {
    path: PathBuf,
    secrets: S,
}

impl<S: OwnerSecretStore> BuzzConnectionRepository<S> {
    pub fn new(path: PathBuf, secrets: S) -> Self {
        Self { path, secrets }
    }

    pub fn load(&self) -> Result<BuzzConnectionsDocument, BuzzConnectionError> {
        load_document(&self.path)
    }

    pub fn add_connection(
        &self,
        label: &str,
        relay_url: &str,
        nsec: OwnerNsec,
    ) -> Result<BuzzConnectionMetadata, BuzzConnectionError> {
        let owner = nsec.identity()?;
        let connection = BuzzConnectionMetadata::new(label, relay_url, &owner)?;
        let mut document = self.load()?;
        if document.connections.iter().any(|existing| {
            existing.relay_url == connection.relay_url
                && existing.owner_public_hex == connection.owner_public_hex
        }) {
            return Err(BuzzConnectionError::InvalidInput(
                "this Buzz owner is already saved for that community".into(),
            ));
        }

        self.secrets.store(&connection.keychain_ref, &nsec)?;
        document.connections.push(connection.clone());
        if let Err(error) = save_document(&self.path, &document) {
            let _ = self.secrets.delete(&connection.keychain_ref);
            return Err(error);
        }
        Ok(connection)
    }

    pub fn owner_signer(&self, connection_id: &str) -> Result<OwnerSigner, BuzzConnectionError> {
        let document = self.load()?;
        let connection = document
            .connections
            .iter()
            .find(|candidate| candidate.id == connection_id)
            .ok_or_else(|| BuzzConnectionError::InvalidInput("Buzz connection not found".into()))?;
        let nsec = self
            .secrets
            .load(&connection.keychain_ref)?
            .ok_or(BuzzConnectionError::SecretNotFound)?;
        let signer = OwnerSigner::from_nsec(&nsec)?;
        if signer.public_key().to_hex() != connection.owner_public_hex {
            return Err(BuzzConnectionError::InvalidStoredMetadata(
                "secure owner credential does not match connection metadata".into(),
            ));
        }
        Ok(signer)
    }

    pub fn record_agent(&self, agent: ManagedBuzzAgentMetadata) -> Result<(), BuzzConnectionError> {
        let mut document = self.load()?;
        agent.validate()?;
        if !document
            .connections
            .iter()
            .any(|connection| connection.id == agent.connection_id)
        {
            return Err(BuzzConnectionError::InvalidInput(
                "Buzz connection not found".into(),
            ));
        }
        if document
            .agents
            .iter()
            .any(|existing| existing.agent_public_hex == agent.agent_public_hex)
        {
            return Err(BuzzConnectionError::InvalidInput(
                "this Buzz agent is already managed".into(),
            ));
        }
        document.agents.push(agent);
        save_document(&self.path, &document)
    }

    pub fn forget_agent_by_deployment(
        &self,
        deployment_id: &str,
    ) -> Result<bool, BuzzConnectionError> {
        Uuid::parse_str(deployment_id)
            .map_err(|_| BuzzConnectionError::InvalidInput("deployment id is invalid".into()))?;
        let mut document = self.load()?;
        let previous_len = document.agents.len();
        document
            .agents
            .retain(|agent| agent.deployment_id.as_deref() != Some(deployment_id));
        if document.agents.len() == previous_len {
            return Ok(false);
        }
        save_document(&self.path, &document)?;
        Ok(true)
    }

    pub fn remove_connection(&self, connection_id: &str) -> Result<(), BuzzConnectionError> {
        let mut document = self.load()?;
        if document
            .agents
            .iter()
            .any(|agent| agent.connection_id == connection_id)
        {
            return Err(BuzzConnectionError::InvalidInput(
                "remove or move this connection's managed agents first".into(),
            ));
        }
        let index = document
            .connections
            .iter()
            .position(|candidate| candidate.id == connection_id)
            .ok_or_else(|| BuzzConnectionError::InvalidInput("Buzz connection not found".into()))?;
        let removed = document.connections.remove(index);
        // Save first. A keychain-delete outage may leave an unreachable orphan,
        // but can never leave metadata that claims a deleted credential exists.
        save_document(&self.path, &document)?;
        self.secrets.delete(&removed.keychain_ref)
    }
}

pub struct OwnerSigner {
    keys: Keys,
}

impl OwnerSigner {
    fn from_nsec(nsec: &OwnerNsec) -> Result<Self, BuzzConnectionError> {
        Ok(Self { keys: nsec.keys()? })
    }

    pub fn public_key(&self) -> PublicKey {
        self.keys.public_key()
    }

    pub(crate) fn keys(&self) -> Keys {
        self.keys.clone()
    }
}

/// A generated per-agent identity. This type is intentionally non-serializable
/// and non-Debug; only explicit native launch code may export its nsec.
pub struct AgentIdentity {
    keys: Keys,
}

impl AgentIdentity {
    pub fn generate() -> Self {
        Self {
            keys: Keys::generate(),
        }
    }

    pub fn from_nsec(nsec: &SecretString) -> Result<Self, BuzzConnectionError> {
        let keys = Keys::parse(nsec.expose_secret()).map_err(|_| {
            BuzzConnectionError::InvalidInput("stored Buzz agent identity is invalid".into())
        })?;
        Ok(Self { keys })
    }

    pub fn public_hex(&self) -> String {
        self.keys.public_key().to_hex()
    }

    pub fn public_key(&self) -> PublicKey {
        self.keys.public_key()
    }

    pub(crate) fn keys(&self) -> Keys {
        self.keys.clone()
    }

    pub fn npub(&self) -> Result<String, BuzzConnectionError> {
        self.keys
            .public_key()
            .to_bech32()
            .map_err(|_| BuzzConnectionError::InvalidInput("could not encode agent npub".into()))
    }

    pub(crate) fn private_nsec(&self) -> Result<SecretString, BuzzConnectionError> {
        self.keys
            .secret_key()
            .to_bech32()
            .map(SecretString::from)
            .map_err(|_| BuzzConnectionError::InvalidInput("could not encode agent nsec".into()))
    }
}

/// Exact NIP-OA owner attestation used by upstream Buzz.
///
/// Wire shape: `["auth", owner_hex, conditions, schnorr_signature]` over
/// `sha256("nostr:agent-auth:" + agent_hex + ":" + conditions)`.
pub fn build_owner_attestation(
    owner: &OwnerSigner,
    agent_public_key: &PublicKey,
    conditions: &str,
) -> Result<SecretString, BuzzConnectionError> {
    if owner.public_key() == *agent_public_key {
        return Err(BuzzConnectionError::InvalidInput(
            "owner and agent public keys must differ".into(),
        ));
    }
    validate_conditions(conditions)?;
    let preimage = format!(
        "nostr:agent-auth:{}:{}",
        agent_public_key.to_hex(),
        conditions
    );
    let digest = sha256::Hash::hash(preimage.as_bytes());
    let message = Message::from_digest(digest.to_byte_array());
    let signature = owner.keys.sign_schnorr(&message);
    let json = serde_json::json!([
        "auth",
        owner.public_key().to_hex(),
        conditions,
        signature.to_string()
    ])
    .to_string();
    verify_owner_attestation(&json, agent_public_key)?;
    Ok(SecretString::from(json))
}

pub fn verify_owner_attestation(
    auth_tag_json: &str,
    agent_public_key: &PublicKey,
) -> Result<PublicKey, BuzzConnectionError> {
    let values: Vec<String> = serde_json::from_str(auth_tag_json)
        .map_err(|_| BuzzConnectionError::InvalidInput("owner attestation is malformed".into()))?;
    if values.len() != 4 || values[0] != "auth" {
        return Err(BuzzConnectionError::InvalidInput(
            "owner attestation is malformed".into(),
        ));
    }
    validate_conditions(&values[2])?;
    if values[1].len() != 64 || values[3].len() != 128 {
        return Err(BuzzConnectionError::InvalidInput(
            "owner attestation is malformed".into(),
        ));
    }
    if !values[1].bytes().all(is_lower_hex) || !values[3].bytes().all(is_lower_hex) {
        return Err(BuzzConnectionError::InvalidInput(
            "owner attestation must use lowercase hex".into(),
        ));
    }
    let owner_public_key = PublicKey::from_hex(&values[1])
        .map_err(|_| BuzzConnectionError::InvalidInput("owner attestation is malformed".into()))?;
    if owner_public_key == *agent_public_key {
        return Err(BuzzConnectionError::InvalidInput(
            "owner and agent public keys must differ".into(),
        ));
    }
    let signature = Signature::from_str(&values[3])
        .map_err(|_| BuzzConnectionError::InvalidInput("owner attestation is malformed".into()))?;
    let preimage = format!(
        "nostr:agent-auth:{}:{}",
        agent_public_key.to_hex(),
        values[2]
    );
    let digest = sha256::Hash::hash(preimage.as_bytes());
    let message = Message::from_digest(digest.to_byte_array());
    let xonly = owner_public_key
        .xonly()
        .map_err(|_| BuzzConnectionError::InvalidInput("owner attestation is malformed".into()))?;
    SECP256K1
        .verify_schnorr(&signature, &message, &xonly)
        .map_err(|_| {
            BuzzConnectionError::InvalidInput("owner attestation signature is invalid".into())
        })?;
    Ok(owner_public_key)
}

pub fn build_agent_profile_event(
    agent: &AgentIdentity,
    display_name: &str,
    picture: Option<&str>,
    about: Option<&str>,
    owner_attestation: &SecretString,
) -> Result<Event, BuzzConnectionError> {
    let verified_owner =
        verify_owner_attestation(owner_attestation.expose_secret(), &agent.keys.public_key())?;
    if verified_owner == agent.keys.public_key() {
        return Err(BuzzConnectionError::InvalidInput(
            "self-attested agent profile is not allowed".into(),
        ));
    }
    let display_name = display_name.trim();
    if display_name.is_empty() || display_name.len() > 120 {
        return Err(BuzzConnectionError::InvalidInput(
            "agent display name must be 1-120 characters".into(),
        ));
    }
    let mut metadata = serde_json::Map::new();
    metadata.insert(
        "display_name".into(),
        serde_json::Value::String(display_name.into()),
    );
    if let Some(picture) = picture.filter(|value| !value.trim().is_empty()) {
        metadata.insert("picture".into(), serde_json::Value::String(picture.into()));
    }
    if let Some(about) = about.filter(|value| !value.trim().is_empty()) {
        metadata.insert("about".into(), serde_json::Value::String(about.into()));
    }
    let auth_values: Vec<String> = serde_json::from_str(owner_attestation.expose_secret())
        .map_err(|_| BuzzConnectionError::InvalidInput("owner attestation is malformed".into()))?;
    let auth_tag = Tag::parse(auth_values)
        .map_err(|_| BuzzConnectionError::InvalidInput("owner attestation is malformed".into()))?;
    EventBuilder::new(
        Kind::Metadata,
        serde_json::Value::Object(metadata).to_string(),
    )
    .tags([auth_tag])
    .sign_with_keys(&agent.keys)
    .map_err(|_| BuzzConnectionError::InvalidInput("could not sign agent profile".into()))
}

pub fn build_bot_enrollment_event(
    owner: &OwnerSigner,
    channel_id: &str,
    agent_public_key: &PublicKey,
) -> Result<Event, BuzzConnectionError> {
    build_membership_event(owner, 9000, channel_id, agent_public_key, true)
}

pub fn build_bot_removal_event(
    owner: &OwnerSigner,
    channel_id: &str,
    agent_public_key: &PublicKey,
) -> Result<Event, BuzzConnectionError> {
    build_membership_event(owner, 9001, channel_id, agent_public_key, false)
}

fn build_membership_event(
    owner: &OwnerSigner,
    kind: u16,
    channel_id: &str,
    agent_public_key: &PublicKey,
    include_role: bool,
) -> Result<Event, BuzzConnectionError> {
    let channel_id = Uuid::parse_str(channel_id)
        .map_err(|_| BuzzConnectionError::InvalidInput("channel id must be a UUID".into()))?;
    let channel = channel_id.to_string();
    let agent = agent_public_key.to_hex();
    let mut tags = vec![
        Tag::parse(["h", channel.as_str()]).map_err(|_| {
            BuzzConnectionError::InvalidInput("could not encode channel tag".into())
        })?,
        Tag::parse(["p", agent.as_str()])
            .map_err(|_| BuzzConnectionError::InvalidInput("could not encode agent tag".into()))?,
    ];
    if include_role {
        tags.push(
            Tag::parse(["role", "bot"]).map_err(|_| {
                BuzzConnectionError::InvalidInput("could not encode bot role".into())
            })?,
        );
    }
    EventBuilder::new(Kind::Custom(kind), "")
        .tags(tags)
        .sign_with_keys(&owner.keys)
        .map_err(|_| BuzzConnectionError::InvalidInput("could not sign channel event".into()))
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct VisibleChannel {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub is_private: bool,
    pub is_member: bool,
}

/// Converts already-authenticated relay query results into the channel picker
/// model. Transport should query kind 39002 with `#p=<owner>` first, then kind
/// 39000 for those channel ids plus the open-channel directory, exactly as Buzz
/// Desktop does. Private metadata without a matching membership is omitted.
pub fn discover_visible_channels(
    metadata_events: &[Event],
    membership_events: &[Event],
    viewer: &PublicKey,
) -> Result<Vec<VisibleChannel>, BuzzConnectionError> {
    let viewer_hex = viewer.to_hex();
    let mut memberships: HashMap<String, bool> = HashMap::new();
    for event in membership_events
        .iter()
        .filter(|event| event.kind.as_u16() == 39002)
    {
        let Some(channel_id) = tag_value(event, "d") else {
            continue;
        };
        if Uuid::parse_str(channel_id).is_err() {
            continue;
        }
        let is_member = event.tags.iter().any(|tag| {
            let values = tag.as_slice();
            values.first().map(String::as_str) == Some("p")
                && values.get(1).map(String::as_str) == Some(viewer_hex.as_str())
        });
        memberships.insert(channel_id.to_owned(), is_member);
    }

    let mut newest: HashMap<String, &Event> = HashMap::new();
    for event in metadata_events
        .iter()
        .filter(|event| event.kind.as_u16() == 39000)
    {
        let Some(channel_id) = tag_value(event, "d") else {
            continue;
        };
        if Uuid::parse_str(channel_id).is_err() {
            continue;
        }
        let replace = newest
            .get(channel_id)
            .map(|current| event.created_at > current.created_at)
            .unwrap_or(true);
        if replace {
            newest.insert(channel_id.to_owned(), event);
        }
    }

    let mut channels = Vec::new();
    for (id, event) in newest {
        if has_tag(event, "hidden") {
            continue;
        }
        let is_private = has_tag(event, "private");
        let is_member = memberships.get(&id).copied().unwrap_or(false);
        if is_private && !is_member {
            continue;
        }
        let Some(name) = tag_value(event, "name").map(str::trim) else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        channels.push(VisibleChannel {
            id,
            name: name.to_owned(),
            description: tag_value(event, "about")
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned),
            is_private,
            is_member,
        });
    }
    channels.sort_by(|left, right| {
        left.name
            .to_ascii_lowercase()
            .cmp(&right.name.to_ascii_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(channels)
}

pub fn canonical_relay_url(value: &str) -> Result<String, BuzzConnectionError> {
    let relay = RelayUrl::parse(value.trim()).map_err(|_| {
        BuzzConnectionError::InvalidInput(
            "community relay must be a valid ws:// or wss:// URL".into(),
        )
    })?;
    let canonical = relay.to_string();
    if !(canonical.starts_with("ws://") || canonical.starts_with("wss://")) {
        return Err(BuzzConnectionError::InvalidInput(
            "community relay must use ws:// or wss://".into(),
        ));
    }
    Ok(canonical)
}

fn load_document(path: &Path) -> Result<BuzzConnectionsDocument, BuzzConnectionError> {
    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(BuzzConnectionsDocument::default())
        }
        Err(error) => return Err(error.into()),
    };
    let len = file.metadata()?.len();
    if len > MAX_DOCUMENT_BYTES {
        return Err(BuzzConnectionError::InvalidStoredMetadata(
            "document is unexpectedly large".into(),
        ));
    }
    let mut bytes = Vec::with_capacity(len as usize);
    file.read_to_end(&mut bytes)?;
    let value: serde_json::Value = serde_json::from_slice(&bytes)?;
    reject_secret_fields(&value)?;
    let document: BuzzConnectionsDocument = serde_json::from_value(value)?;
    document.validate()?;
    Ok(document)
}

fn save_document(
    path: &Path,
    document: &BuzzConnectionsDocument,
) -> Result<(), BuzzConnectionError> {
    document.validate()?;
    let bytes = serde_json::to_vec_pretty(document)?;
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(BuzzConnectionError::InvalidStoredMetadata(
            "document is unexpectedly large".into(),
        ));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = atomic_write_file::AtomicWriteFile::open(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    file.write_all(&bytes)?;
    file.commit()?;
    Ok(())
}

fn normalize_label(value: &str) -> Result<String, BuzzConnectionError> {
    let label = value.trim();
    if label.is_empty() || label.len() > 80 || label.chars().any(char::is_control) {
        return Err(BuzzConnectionError::InvalidInput(
            "connection label must be 1-80 printable characters".into(),
        ));
    }
    Ok(label.to_owned())
}

fn validate_keychain_ref(value: &str) -> Result<(), BuzzConnectionError> {
    let Some(id) = value.strip_prefix("buzz-owner/") else {
        return Err(BuzzConnectionError::InvalidStoredMetadata(
            "keychain reference is invalid".into(),
        ));
    };
    Uuid::parse_str(id).map_err(|_| {
        BuzzConnectionError::InvalidStoredMetadata("keychain reference is invalid".into())
    })?;
    Ok(())
}

fn parse_public_key_hex(value: &str) -> Result<PublicKey, BuzzConnectionError> {
    if value.len() != 64 || !value.bytes().all(is_lower_hex) {
        return Err(BuzzConnectionError::InvalidStoredMetadata(
            "public key must be 64 lowercase hex characters".into(),
        ));
    }
    PublicKey::from_hex(value)
        .map_err(|_| BuzzConnectionError::InvalidStoredMetadata("public key is invalid".into()))
}

fn is_lower_hex(byte: u8) -> bool {
    byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
}

fn validate_conditions(value: &str) -> Result<(), BuzzConnectionError> {
    if value.is_empty() {
        return Ok(());
    }
    if value.bytes().any(|byte| byte.is_ascii_whitespace()) {
        return Err(BuzzConnectionError::InvalidInput(
            "owner attestation conditions cannot contain whitespace".into(),
        ));
    }
    for clause in value.split('&') {
        let (label, number, maximum) = if let Some(number) = clause.strip_prefix("kind=") {
            ("kind", number, 65_535_u64)
        } else if let Some(number) = clause.strip_prefix("created_at<") {
            ("created_at", number, 4_294_967_295_u64)
        } else if let Some(number) = clause.strip_prefix("created_at>") {
            ("created_at", number, 4_294_967_295_u64)
        } else {
            return Err(BuzzConnectionError::InvalidInput(
                "owner attestation condition is unsupported".into(),
            ));
        };
        if number.is_empty()
            || (number.len() > 1 && number.starts_with('0'))
            || !number.bytes().all(|byte| byte.is_ascii_digit())
            || number
                .parse::<u64>()
                .map(|value| value > maximum)
                .unwrap_or(true)
        {
            return Err(BuzzConnectionError::InvalidInput(format!(
                "owner attestation {label} condition is invalid"
            )));
        }
    }
    Ok(())
}

fn reject_secret_fields(value: &serde_json::Value) -> Result<(), BuzzConnectionError> {
    match value {
        serde_json::Value::Object(map) => {
            for (key, value) in map {
                if is_secret_field_name(key) {
                    return Err(BuzzConnectionError::InvalidStoredMetadata(
                        "secret-bearing field is forbidden".into(),
                    ));
                }
                reject_secret_fields(value)?;
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                reject_secret_fields(value)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn is_secret_field_name(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "nsec"
            | "secret"
            | "secret_hex"
            | "private_key"
            | "private_key_nsec"
            | "auth_tag"
            | "password"
            | "token"
    )
}

fn tag_value<'a>(event: &'a Event, name: &str) -> Option<&'a str> {
    event.tags.iter().find_map(|tag| {
        let values = tag.as_slice();
        (values.first().map(String::as_str) == Some(name))
            .then(|| values.get(1).map(String::as_str))
            .flatten()
    })
}

fn has_tag(event: &Event, name: &str) -> bool {
    event
        .tags
        .iter()
        .any(|tag| tag.as_slice().first().map(String::as_str) == Some(name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeSecretStore {
        values: Mutex<HashMap<String, String>>,
    }

    impl OwnerSecretStore for FakeSecretStore {
        fn store(&self, keychain_ref: &str, nsec: &OwnerNsec) -> Result<(), BuzzConnectionError> {
            self.values
                .lock()
                .unwrap()
                .insert(keychain_ref.into(), nsec.0.expose_secret().to_owned());
            Ok(())
        }

        fn load(&self, keychain_ref: &str) -> Result<Option<OwnerNsec>, BuzzConnectionError> {
            self.values
                .lock()
                .unwrap()
                .get(keychain_ref)
                .map(|value| OwnerNsec::parse(value))
                .transpose()
        }

        fn delete(&self, keychain_ref: &str) -> Result<(), BuzzConnectionError> {
            self.values.lock().unwrap().remove(keychain_ref);
            Ok(())
        }
    }

    fn owner_nsec() -> OwnerNsec {
        OwnerNsec::parse(&Keys::generate().secret_key().to_bech32().unwrap()).unwrap()
    }

    fn tag_values(event: &Event, name: &str) -> Vec<Vec<String>> {
        event
            .tags
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .filter(|tag| tag.first().map(String::as_str) == Some(name))
            .collect()
    }

    #[test]
    fn nsec_validation_derives_matching_public_identity() {
        let keys = Keys::generate();
        let nsec = keys.secret_key().to_bech32().unwrap();
        let parsed = OwnerNsec::parse(&nsec).unwrap();
        let identity = parsed.identity().unwrap();
        assert_eq!(identity.public_hex, keys.public_key().to_hex());
        assert_eq!(identity.npub, keys.public_key().to_bech32().unwrap());
        assert!(OwnerNsec::parse("not-a-secret").is_err());
        assert!(OwnerNsec::parse(&keys.secret_key().to_secret_hex()).is_err());
    }

    #[test]
    fn repository_keeps_nsec_out_of_json_and_verifies_keychain_identity() {
        let dir = std::env::temp_dir().join(format!("hypercli-buzz-test-{}", Uuid::new_v4()));
        let path = dir.join("connections.json");
        let repository = BuzzConnectionRepository::new(path.clone(), FakeSecretStore::default());
        let connection = repository
            .add_connection("Dev", "wss://dev.buzz.hypercli.com", owner_nsec())
            .unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        assert!(!raw.contains("nsec1"));
        assert!(!raw.contains("secret_hex"));
        assert_eq!(
            repository
                .owner_signer(&connection.id)
                .unwrap()
                .public_key()
                .to_hex(),
            connection.owner_public_hex
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn stored_metadata_rejects_secret_fields_even_if_json_would_ignore_them() {
        let dir = std::env::temp_dir().join(format!("hypercli-buzz-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("connections.json");
        fs::write(
            &path,
            r#"{"version":1,"connections":[],"agents":[],"nsec":"nsec1forbidden"}"#,
        )
        .unwrap();
        let error = load_document(&path).unwrap_err().to_string();
        assert!(error.contains("secret-bearing field"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn owner_attestation_and_profile_match_upstream_wire_shape() {
        let owner_nsec = owner_nsec();
        let owner = OwnerSigner::from_nsec(&owner_nsec).unwrap();
        let agent = AgentIdentity::generate();
        let agent_nsec = agent.private_nsec().unwrap();
        assert!(agent_nsec.expose_secret().starts_with("nsec1"));
        let auth = build_owner_attestation(&owner, &agent.keys.public_key(), "").unwrap();
        assert!(!auth.expose_secret().contains("nsec1"));
        assert_eq!(
            verify_owner_attestation(auth.expose_secret(), &agent.keys.public_key()).unwrap(),
            owner.public_key()
        );

        let profile = build_agent_profile_event(
            &agent,
            "Maverick",
            Some("https://example.test/avatar.png"),
            Some("Coding agent"),
            &auth,
        )
        .unwrap();
        assert_eq!(profile.kind, Kind::Metadata);
        assert_eq!(profile.pubkey, agent.keys.public_key());
        let auth_tags = tag_values(&profile, "auth");
        assert_eq!(auth_tags.len(), 1);
        assert_eq!(auth_tags[0][1], owner.public_key().to_hex());
        assert_eq!(auth_tags[0].len(), 4);
    }

    #[test]
    fn bot_enrollment_and_removal_are_owner_signed_nip29_events() {
        let owner = OwnerSigner::from_nsec(&owner_nsec()).unwrap();
        let agent = AgentIdentity::generate();
        let channel = Uuid::new_v4().to_string();
        let add = build_bot_enrollment_event(&owner, &channel, &agent.keys.public_key()).unwrap();
        assert_eq!(add.kind.as_u16(), 9000);
        assert_eq!(add.pubkey, owner.public_key());
        assert_eq!(tag_values(&add, "h")[0][1], channel);
        assert_eq!(tag_values(&add, "p")[0][1], agent.public_hex());
        assert_eq!(tag_values(&add, "role")[0][1], "bot");

        let remove = build_bot_removal_event(&owner, &channel, &agent.keys.public_key()).unwrap();
        assert_eq!(remove.kind.as_u16(), 9001);
        assert!(tag_values(&remove, "role").is_empty());
    }

    fn discovery_event(keys: &Keys, kind: u16, tags: Vec<Tag>) -> Event {
        EventBuilder::new(Kind::Custom(kind), "")
            .tags(tags)
            .sign_with_keys(keys)
            .unwrap()
    }

    #[test]
    fn discovery_hides_private_channels_without_matching_membership() {
        let relay = Keys::generate();
        let viewer = Keys::generate();
        let open_id = Uuid::new_v4().to_string();
        let private_id = Uuid::new_v4().to_string();
        let open = discovery_event(
            &relay,
            39000,
            vec![
                Tag::parse(["d", open_id.as_str()]).unwrap(),
                Tag::parse(["name", "General"]).unwrap(),
                Tag::parse(["closed"]).unwrap(),
            ],
        );
        let private = discovery_event(
            &relay,
            39000,
            vec![
                Tag::parse(["d", private_id.as_str()]).unwrap(),
                Tag::parse(["name", "CI"]).unwrap(),
                Tag::parse(["closed"]).unwrap(),
                Tag::parse(["private"]).unwrap(),
            ],
        );
        let membership = discovery_event(
            &relay,
            39002,
            vec![
                Tag::parse(["d", private_id.as_str()]).unwrap(),
                Tag::parse(["p", viewer.public_key().to_hex().as_str(), "", "member"]).unwrap(),
            ],
        );
        let visible =
            discover_visible_channels(&[open.clone(), private.clone()], &[], &viewer.public_key())
                .unwrap();
        assert_eq!(
            visible.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            vec!["General"]
        );

        let visible =
            discover_visible_channels(&[open, private], &[membership], &viewer.public_key())
                .unwrap();
        assert_eq!(
            visible.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            vec!["CI", "General"]
        );
        assert!(visible.iter().find(|c| c.name == "CI").unwrap().is_member);
    }

    #[test]
    fn invalid_conditions_and_self_attestation_fail_closed() {
        let nsec = owner_nsec();
        let owner = OwnerSigner::from_nsec(&nsec).unwrap();
        assert!(build_owner_attestation(&owner, &owner.public_key(), "").is_err());
        let agent = AgentIdentity::generate();
        assert!(build_owner_attestation(&owner, &agent.keys.public_key(), "kind=01").is_err());
        assert!(
            build_owner_attestation(&owner, &agent.keys.public_key(), "kind=9 & kind=0").is_err()
        );
    }
}
