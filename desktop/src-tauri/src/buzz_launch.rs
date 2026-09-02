//! Buzz agent launch path: local Nostr identity, relay enrollment, and the
//! create → enroll → start sequence. Ported from the original desktop app's
//! `lib.rs`; owner keys never leave `buzz_connections` and agent keys are
//! generated here per launch — nothing Nostr is persisted backend-side
//! beyond the public-key tags the relay contract requires.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::time::Duration;

use base64::Engine;
use hypercli_sdk::{
    canonical_deployment_name, AgentSize, BuzzLaunchConfig, CreateDeploymentRequest, Deployment,
    HyperCliClient, ManagedRuntime, StartDeploymentRequest,
};
use nostr::hashes::{sha256, Hash};
use nostr::{
    Event as NostrEvent, EventBuilder as NostrEventBuilder, Kind as NostrKind, Tag as NostrTag,
};
use nostr_sdk::Client as NostrClient;
use secrecy::{ExposeSecret, SecretString};
use serde::Deserialize;
use serde_json::Value;
use tauri::Emitter;

use crate::buzz_connections::{
    build_agent_profile_event, build_bot_enrollment_event, build_bot_removal_event,
    build_managed_agent_event, build_managed_agent_removal_event, build_owner_attestation,
    discover_visible_channels, AgentIdentity, BuzzConnectionMetadata, BuzzConnectionRepository,
    ManagedAgentProjection, ManagedBuzzAgentMetadata, OwnerNsec, OwnerSigner,
    SystemOwnerSecretStore, VisibleChannel,
};
use crate::{checked_agent_id, home_dir, managed_client, LauncherAgent};

const DEFAULT_BUZZ_MODEL: &str = "default-anthropic";

#[derive(Deserialize)]
struct ModelCatalogResponse {
    data: Vec<ModelCatalogEntry>,
}

#[derive(Deserialize)]
struct ModelCatalogEntry {
    id: String,
}

fn fetch_model_catalog_blocking() -> Result<Vec<String>, String> {
    let config = hypercli_sdk::discover_client_config().map_err(|error| error.to_string())?;
    let mut url = config.api_base.clone();
    url.set_path("/v1/models");
    url.set_query(None);
    url.set_fragment(None);
    let response = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?
        .get(url)
        .bearer_auth(config.api_key.expose_secret())
        .send()
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "model catalog returned HTTP {}",
            response.status().as_u16()
        ));
    }
    let catalog: ModelCatalogResponse = response
        .json()
        .map_err(|_| "model catalog returned an invalid response".to_owned())?;
    Ok(catalog.data.into_iter().map(|entry| entry.id).collect())
}

/// Resolve the model for a buzz launch against the live gateway catalog.
/// Blank input defaults to the gateway's default-anthropic alias. A requested
/// model that is not served is rejected — never silently substituted.
fn resolve_launch_model_blocking(model: Option<&str>) -> Result<Option<String>, String> {
    let requested = model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    match fetch_model_catalog_blocking() {
        Ok(catalog) => {
            let effective = requested
                .clone()
                .unwrap_or_else(|| DEFAULT_BUZZ_MODEL.to_owned());
            if catalog.iter().any(|id| id == &effective) {
                Ok(Some(effective))
            } else if requested.is_some() {
                Err(format!(
                    "Model '{effective}' is not served by the inference gateway. Available: {}",
                    catalog.join(", ")
                ))
            } else {
                Ok(None)
            }
        }
        Err(_) if requested.is_none() => Ok(None),
        Err(error) => Err(format!(
            "Could not reach the model catalog to validate the requested model: {error}"
        )),
    }
}

#[derive(Deserialize)]
pub struct BuzzConnectionInput {
    label: String,
    relay: String,
    nsec: String,
}

/// Buzz launch form payload. Deliberately slimmer than the original desktop
/// editor: no avatar staging, no free-form env, no sync overrides.
#[derive(Clone, Deserialize)]
pub struct BuzzCreateInput {
    name: String,
    #[serde(default)]
    instructions: Option<String>,
    runtime: String,
    #[serde(default)]
    size: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    concurrency: Option<u32>,
    connection_id: String,
    #[serde(default)]
    channels: Vec<String>,
    respond_to: String,
    #[serde(default)]
    allowlist: Vec<String>,
}

fn buzz_connections_path() -> Result<PathBuf, String> {
    let root = dirs::config_dir().unwrap_or(home_dir()?.join(".config"));
    Ok(root.join("hypercli").join("buzz-connections.json"))
}

fn buzz_connection_repository() -> Result<BuzzConnectionRepository<SystemOwnerSecretStore>, String>
{
    Ok(BuzzConnectionRepository::new(
        buzz_connections_path()?,
        SystemOwnerSecretStore::new(),
    ))
}

#[tauri::command]
pub fn list_buzz_connections() -> Result<Vec<BuzzConnectionMetadata>, String> {
    buzz_connection_repository()?
        .load()
        .map(|document| document.connections)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_buzz_connection(
    app: tauri::AppHandle,
    input: BuzzConnectionInput,
) -> Result<BuzzConnectionMetadata, String> {
    let nsec = OwnerNsec::parse(&input.nsec).map_err(|error| error.to_string())?;
    let metadata = buzz_connection_repository()?
        .add_connection(&input.label, &input.relay, nsec)
        .map_err(|error| error.to_string())?;
    let _ = app.emit("buzz-connections-changed", ());
    Ok(metadata)
}

#[tauri::command]
pub fn remove_buzz_connection(app: tauri::AppHandle, connection_id: String) -> Result<(), String> {
    let connection_id = checked_agent_id(&connection_id)?;
    buzz_connection_repository()?
        .remove_connection(&connection_id)
        .map_err(|error| error.to_string())?;
    let _ = app.emit("buzz-connections-changed", ());
    Ok(())
}

fn parse_buzz_runtime(value: &str) -> Result<ManagedRuntime, String> {
    match value.trim() {
        "buzz-agent" => Ok(ManagedRuntime::BuzzAgent),
        "opencode" => Ok(ManagedRuntime::Opencode),
        "goose" => Ok(ManagedRuntime::Goose),
        "claude-code" => Ok(ManagedRuntime::ClaudeCode),
        "codex" => Ok(ManagedRuntime::Codex),
        "kimi-code" => Ok(ManagedRuntime::KimiCode),
        _ => Err("Unsupported coding runtime".to_owned()),
    }
}

fn parse_buzz_size(value: Option<&str>) -> Result<Option<AgentSize>, String> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        None => Ok(None),
        Some("small") => Ok(Some(AgentSize::Small)),
        Some("medium") => Ok(Some(AgentSize::Medium)),
        Some("large") => Ok(Some(AgentSize::Large)),
        Some(_) => Err("Size must be small, medium, large, or automatic".to_owned()),
    }
}

fn validate_buzz_input(input: &BuzzCreateInput) -> Result<(), String> {
    let name = input.name.trim();
    if name.is_empty() || name.len() > 32 {
        return Err("Agent name must be between 1 and 32 characters".to_owned());
    }
    if input
        .instructions
        .as_deref()
        .is_some_and(|value| value.len() > 64 * 1024)
    {
        return Err("Agent instructions are too large".to_owned());
    }
    if !matches!(
        input.respond_to.trim(),
        "owner-only" | "allowlist" | "anyone"
    ) {
        return Err("Invalid respond-to policy".to_owned());
    }
    if input.respond_to.trim() == "allowlist" && input.allowlist.is_empty() {
        return Err("Selected people requires at least one npub or nickname".to_owned());
    }
    if input.allowlist.len() > 64 {
        return Err("Selected people supports at most 64 entries".to_owned());
    }
    if let Some(concurrency) = input.concurrency {
        if !(1..=32).contains(&concurrency) {
            return Err("Concurrency must be between 1 and 32".to_owned());
        }
    }
    for entry in &input.allowlist {
        if entry.trim().is_empty()
            || entry.len() > 256
            || entry.chars().any(char::is_control)
            || entry.contains(',')
        {
            return Err("Allowlist entries must be one npub or nickname per line".to_owned());
        }
    }
    Ok(())
}

async fn fetch_buzz_channels(
    relay: String,
    signer: nostr::Keys,
) -> Result<Vec<VisibleChannel>, String> {
    let viewer = signer.public_key();
    // Match upstream Buzz Desktop/buzz-acp: private group discovery is read
    // through the relay's authenticated HTTP query bridge, not a bare WS
    // subscription. The latter can connect successfully yet see no private
    // 39002 state on hosted communities.
    let memberships = query_buzz_events_http(
        &relay,
        &signer,
        serde_json::json!([{
            "kinds": [39002],
            "#p": [viewer.to_hex()],
            "limit": 1000,
        }]),
    )
    .await
    .map_err(|error| format!("Could not read Buzz channel memberships: {error}"))?;
    let mut channel_ids = memberships
        .iter()
        .filter_map(|event| {
            event.tags.iter().find_map(|tag| {
                let values = tag.as_slice();
                (values.first().map(String::as_str) == Some("d"))
                    .then(|| values.get(1).cloned())
                    .flatten()
            })
        })
        .collect::<Vec<_>>();
    channel_ids.sort();
    channel_ids.dedup();
    let metadata = if channel_ids.is_empty() {
        Vec::new()
    } else {
        let channel_limit = channel_ids.len();
        query_buzz_events_http(
            &relay,
            &signer,
            serde_json::json!([{
                "kinds": [39000],
                "#d": channel_ids,
                "limit": channel_limit,
            }]),
        )
        .await
        .map_err(|error| format!("Could not read Buzz channels: {error}"))?
    };
    discover_visible_channels(&metadata, &memberships, &viewer).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_buzz_channels(connection_id: String) -> Result<Vec<VisibleChannel>, String> {
    let connection_id = checked_agent_id(&connection_id)?;
    let (relay, signer) = tauri::async_runtime::spawn_blocking(move || {
        let repository = buzz_connection_repository()?;
        let document = repository.load().map_err(|error| error.to_string())?;
        let connection = document
            .connections
            .iter()
            .find(|connection| connection.id == connection_id)
            .ok_or_else(|| "Saved Buzz connection not found".to_owned())?;
        let signer = repository
            .owner_signer(&connection_id)
            .map_err(|error| error.to_string())?;
        Ok::<_, String>((connection.relay_url.clone(), signer.keys()))
    })
    .await
    .map_err(|error| error.to_string())??;
    fetch_buzz_channels(relay, signer).await
}

fn canonical_hex_public_key(value: &str) -> Option<String> {
    let value = value.trim();
    (value.len() == 64 && value.chars().all(|character| character.is_ascii_hexdigit()))
        .then(|| nostr::PublicKey::from_hex(value).ok())
        .flatten()
        .map(|public_key| public_key.to_hex())
}

fn explicit_allowlist_public_key(value: &str) -> Result<Option<String>, String> {
    let value = value.trim();
    if value.starts_with("npub1") {
        return nostr::PublicKey::parse(value)
            .map(|public_key| Some(public_key.to_hex()))
            .map_err(|_| format!("Invalid npub: {value}"));
    }
    if value.len() == 64 {
        return canonical_hex_public_key(value)
            .map(Some)
            .ok_or_else(|| "Invalid 64-character public key".to_owned());
    }
    Ok(None)
}

fn profile_aliases(content: &str) -> Vec<String> {
    let Ok(metadata) = serde_json::from_str::<nostr::Metadata>(content) else {
        return Vec::new();
    };
    let mut aliases = Vec::new();
    for value in [metadata.name, metadata.display_name].into_iter().flatten() {
        let value = value.to_ascii_lowercase();
        if value.is_empty() {
            continue;
        }
        aliases.push(value);
    }
    aliases.sort();
    aliases.dedup();
    aliases
}

fn resolve_allowlist_entries(
    entries: &[String],
    selected_channels: &[String],
    membership_events: &[NostrEvent],
    profile_events: &[NostrEvent],
) -> Result<Vec<String>, String> {
    let explicit_entries = entries
        .iter()
        .map(|entry| explicit_allowlist_public_key(entry))
        .collect::<Result<Vec<_>, _>>()?;
    let needs_nickname_lookup = explicit_entries.iter().any(Option::is_none);
    let selected_channels = selected_channels
        .iter()
        .map(String::as_str)
        .collect::<std::collections::HashSet<_>>();
    let mut newest_memberships: HashMap<&str, &NostrEvent> = HashMap::new();
    for event in membership_events
        .iter()
        .filter(|event| event.kind.as_u16() == 39002)
    {
        let channel = event.tags.iter().find_map(|tag| {
            let values = tag.as_slice();
            (values.first().map(String::as_str) == Some("d"))
                .then(|| values.get(1).map(String::as_str))
                .flatten()
        });
        let Some(channel) = channel.filter(|channel| selected_channels.contains(channel)) else {
            continue;
        };
        let replace = newest_memberships
            .get(channel)
            .map(|current| {
                event.created_at > current.created_at
                    || (event.created_at == current.created_at && event.id < current.id)
            })
            .unwrap_or(true);
        if replace {
            newest_memberships.insert(channel, event);
        }
    }
    if needs_nickname_lookup {
        if let Some(missing) = selected_channels
            .iter()
            .find(|channel| !newest_memberships.contains_key(**channel))
        {
            return Err(format!(
                "Could not load the current member roster for Buzz channel {missing}"
            ));
        }
    }

    let mut member_keys = std::collections::HashSet::new();
    for event in newest_memberships.values() {
        for tag in event.tags.iter() {
            let values = tag.as_slice();
            if values.first().map(String::as_str) != Some("p") {
                continue;
            }
            if let Some(public_key) = values
                .get(1)
                .and_then(|value| canonical_hex_public_key(value))
            {
                member_keys.insert(public_key);
            }
        }
    }

    let mut newest_profiles: HashMap<String, &NostrEvent> = HashMap::new();
    for event in profile_events
        .iter()
        .filter(|event| event.kind == nostr::Kind::Metadata)
    {
        let public_key = event.pubkey.to_hex();
        if !member_keys.contains(&public_key) {
            continue;
        }
        let replace = newest_profiles
            .get(&public_key)
            .map(|current| {
                event.created_at > current.created_at
                    || (event.created_at == current.created_at && event.id < current.id)
            })
            .unwrap_or(true);
        if replace {
            newest_profiles.insert(public_key, event);
        }
    }

    let aliases = newest_profiles
        .into_iter()
        .map(|(public_key, event)| (public_key, profile_aliases(&event.content)))
        .collect::<Vec<_>>();
    let mut resolved = Vec::new();
    for entry in entries {
        let entry = entry.trim();
        if let Some(public_key) = explicit_allowlist_public_key(entry)? {
            resolved.push(public_key);
            continue;
        }
        let needle = entry.to_ascii_lowercase();
        let mut matches = aliases
            .iter()
            .filter(|(_, candidate_aliases)| candidate_aliases.contains(&needle))
            .map(|(public_key, _)| public_key.clone())
            .collect::<Vec<_>>();
        matches.sort();
        matches.dedup();
        match matches.as_slice() {
            [public_key] => resolved.push(public_key.clone()),
            [] => {
                return Err(format!(
                    "No member named '{entry}' was found in the selected Buzz channels; use an npub or hex public key"
                ));
            }
            _ => {
                return Err(format!(
                    "More than one member is named '{entry}'; use an npub to disambiguate"
                ));
            }
        }
    }
    resolved.sort();
    resolved.dedup();
    Ok(resolved)
}

async fn resolve_buzz_allowlist(
    relay: &str,
    signer: nostr::Keys,
    channels: &[String],
    entries: &[String],
) -> Result<Vec<String>, String> {
    use nostr::{Alphabet, Filter, Kind, SingleLetterTag};

    if entries.is_empty() {
        return Ok(Vec::new());
    }
    let explicit_entries = entries
        .iter()
        .map(|entry| explicit_allowlist_public_key(entry))
        .collect::<Result<Vec<_>, _>>()?;
    if explicit_entries.iter().all(Option::is_some) {
        return resolve_allowlist_entries(entries, channels, &[], &[]);
    }
    let client = NostrClient::new(signer);
    client
        .add_relay(relay)
        .await
        .map_err(|_| "Could not configure the Buzz relay".to_owned())?;
    client
        .try_connect_relay(relay, Duration::from_secs(10))
        .await
        .map_err(|_| "Could not connect to the Buzz relay".to_owned())?;
    let membership_filter = Filter::new()
        .kind(Kind::Custom(39002))
        .custom_tags(
            SingleLetterTag::lowercase(Alphabet::D),
            channels.iter().cloned(),
        )
        .limit(1000);
    let memberships = client
        .fetch_events(membership_filter, Duration::from_secs(10))
        .await
        .map_err(|_| "Could not read Buzz channel members".to_owned())?
        .into_iter()
        .collect::<Vec<_>>();
    let mut members = memberships
        .iter()
        .flat_map(|event| event.tags.iter())
        .filter_map(|tag| {
            let values = tag.as_slice();
            (values.first().map(String::as_str) == Some("p"))
                .then(|| values.get(1))
                .flatten()
                .and_then(|value| nostr::PublicKey::from_hex(value).ok())
        })
        .collect::<Vec<_>>();
    members.sort_by_key(nostr::PublicKey::to_hex);
    members.dedup();
    if members.len() > 2000 {
        client.disconnect().await;
        return Err(
            "The selected Buzz channels have too many members for nickname lookup; use npubs"
                .to_owned(),
        );
    }
    let profiles = if members.is_empty() {
        Vec::new()
    } else {
        client
            .fetch_events(
                Filter::new()
                    .kind(Kind::Metadata)
                    .authors(members)
                    .limit(2000),
                Duration::from_secs(10),
            )
            .await
            .map_err(|_| "Could not read Buzz member profiles".to_owned())?
            .into_iter()
            .collect::<Vec<_>>()
    };
    client.disconnect().await;
    resolve_allowlist_entries(entries, channels, &memberships, &profiles)
}

async fn publish_buzz_events(
    relay: &str,
    signer: nostr::Keys,
    events: &[NostrEvent],
) -> Result<(), String> {
    let client = NostrClient::new(signer);
    client
        .add_relay(relay)
        .await
        .map_err(|_| "Could not configure the Buzz relay".to_owned())?;
    client
        .try_connect_relay(relay, Duration::from_secs(10))
        .await
        .map_err(|_| "Could not connect to the Buzz relay".to_owned())?;
    for event in events {
        let output = tokio::time::timeout(Duration::from_secs(20), client.send_event(event))
            .await
            .map_err(|_| "Buzz relay publish timed out".to_owned())?
            .map_err(|_| "Buzz relay rejected an event".to_owned())?;
        if output.success.is_empty() {
            client.disconnect().await;
            return Err("Buzz relay did not confirm the event".to_owned());
        }
    }
    client.disconnect().await;
    Ok(())
}

#[derive(Deserialize)]
struct BuzzEventSubmitResponse {
    accepted: bool,
}

/// Open a DM between the freshly launched agent and its owner, then post a
/// short greeting. The agent appears in the owner's DM list on every session,
/// and buzz-acp picks the channel up via the membership notification.
async fn open_owner_dm_with_greeting(
    prepared: &PreparedBuzzLaunch,
    agent_name: &str,
) -> Result<(), String> {
    let owner_hex = prepared.owner_keys.public_key().to_hex();
    let dm_open = NostrEventBuilder::new(NostrKind::from(41010), "")
        .tags([NostrTag::parse(["p", owner_hex.as_str()])
            .map_err(|_| "Could not build the owner DM event".to_owned())?])
        .sign_with_keys(&prepared.agent_keys)
        .map_err(|_| "Could not sign the owner DM event".to_owned())?;
    publish_signed_buzz_event_http(
        &prepared.relay,
        &prepared.agent_keys,
        &dm_open,
        Some(&prepared.auth_tag),
    )
    .await?;

    let memberships = query_buzz_events_http(
        &prepared.relay,
        &prepared.agent_keys,
        serde_json::json!([{ "kinds": [39002], "#p": [prepared.agent_public_hex] }]),
    )
    .await?;
    let channel_ids: Vec<String> = memberships
        .iter()
        .flat_map(|event| event.tags.iter())
        .filter_map(|tag| {
            let parts = tag.as_slice();
            (parts.first().map(String::as_str) == Some("d"))
                .then(|| parts.get(1).cloned())
                .flatten()
        })
        .collect();
    if channel_ids.is_empty() {
        return Ok(());
    }
    let metas = query_buzz_events_http(
        &prepared.relay,
        &prepared.agent_keys,
        serde_json::json!([{ "kinds": [39000], "#d": channel_ids }]),
    )
    .await?;
    let dm_channel = metas.iter().find_map(|event| {
        let tags: Vec<Vec<String>> = event
            .tags
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .collect();
        let is_dm = tags.iter().any(|parts| {
            parts.first().map(String::as_str) == Some("t")
                && parts.get(1).map(String::as_str) == Some("dm")
        });
        let with_owner = tags.iter().any(|parts| {
            parts.first().map(String::as_str) == Some("p")
                && parts.get(1).map(String::as_str) == Some(owner_hex.as_str())
        });
        if !(is_dm && with_owner) {
            return None;
        }
        tags.iter()
            .find(|parts| parts.first().map(String::as_str) == Some("d"))
            .and_then(|parts| parts.get(1).cloned())
    });
    let Some(channel_id) = dm_channel else {
        return Ok(());
    };
    let greeting = NostrEventBuilder::new(
        NostrKind::from(9),
        format!("{agent_name} is online — say hi."),
    )
    .tags([NostrTag::parse(["h", channel_id.as_str()])
        .map_err(|_| "Could not build the greeting event".to_owned())?])
    .sign_with_keys(&prepared.agent_keys)
    .map_err(|_| "Could not sign the greeting event".to_owned())?;
    publish_signed_buzz_event_http(
        &prepared.relay,
        &prepared.agent_keys,
        &greeting,
        Some(&prepared.auth_tag),
    )
    .await
}

fn relay_http_events_url(relay: &str) -> Result<String, String> {
    let relay = relay.trim().trim_end_matches('/');
    if let Some(suffix) = relay.strip_prefix("wss://") {
        return Ok(format!("https://{suffix}/events"));
    }
    if let Some(suffix) = relay.strip_prefix("ws://") {
        return Ok(format!("http://{suffix}/events"));
    }
    Err("Buzz relay must use ws:// or wss://".to_owned())
}

fn relay_http_query_url(relay: &str) -> Result<String, String> {
    relay_http_events_url(relay).map(|url| url.trim_end_matches("/events").to_owned() + "/query")
}

fn build_nip98_authorization(
    signer: &nostr::Keys,
    url: &str,
    body: &[u8],
) -> Result<String, String> {
    let payload = sha256::Hash::hash(body).to_string();
    let nonce = uuid::Uuid::new_v4().to_string();
    let tags = [
        NostrTag::parse(["u", url]).map_err(|_| "Could not sign Buzz request".to_owned())?,
        NostrTag::parse(["method", "POST"])
            .map_err(|_| "Could not sign Buzz request".to_owned())?,
        NostrTag::parse(["payload", payload.as_str()])
            .map_err(|_| "Could not sign Buzz request".to_owned())?,
        NostrTag::parse(["nonce", nonce.as_str()])
            .map_err(|_| "Could not sign Buzz request".to_owned())?,
    ];
    let event = NostrEventBuilder::new(NostrKind::HttpAuth, "")
        .tags(tags)
        .sign_with_keys(signer)
        .map_err(|_| "Could not sign Buzz request".to_owned())?;
    let event_json = serde_json::to_vec(&event)
        .map_err(|_| "Could not serialize Buzz authorization".to_owned())?;
    Ok(format!(
        "Nostr {}",
        base64::engine::general_purpose::STANDARD.encode(event_json)
    ))
}

async fn query_buzz_events_http(
    relay: &str,
    signer: &nostr::Keys,
    filters: Value,
) -> Result<Vec<NostrEvent>, String> {
    let url = relay_http_query_url(relay)?;
    let body = serde_json::to_vec(&filters)
        .map_err(|_| "Could not serialize the Buzz query".to_owned())?;
    let authorization = build_nip98_authorization(signer, &url, &body)?;
    let response = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "Could not configure the Buzz relay client".to_owned())?
        .post(&url)
        .header(reqwest::header::AUTHORIZATION, authorization)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
        .map_err(|_| "Buzz relay query failed".to_owned())?;
    if !response.status().is_success() {
        return Err(format!("Buzz relay returned HTTP {}", response.status()));
    }
    response
        .json::<Vec<NostrEvent>>()
        .await
        .map_err(|_| "Buzz relay returned an invalid event list".to_owned())
}

async fn publish_signed_buzz_event_http(
    relay: &str,
    signer: &nostr::Keys,
    event: &NostrEvent,
    auth_tag: Option<&SecretString>,
) -> Result<(), String> {
    validate_buzz_event_author(signer, event)?;
    let url = relay_http_events_url(relay)?;
    let body =
        serde_json::to_vec(event).map_err(|_| "Could not serialize the Buzz event".to_owned())?;
    let authorization = build_nip98_authorization(signer, &url, &body)?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "Could not configure the Buzz relay client".to_owned())?;
    let mut request = client
        .post(url)
        .header(reqwest::header::AUTHORIZATION, authorization)
        .header(reqwest::header::CONTENT_TYPE, "application/json");
    if let Some(auth_tag) = auth_tag {
        request = request.header("x-auth-tag", auth_tag.expose_secret());
    }
    let response = request
        .body(body)
        .send()
        .await
        .map_err(|_| "Could not reach the Buzz relay".to_owned())?;
    if !response.status().is_success() {
        return Err("Buzz relay rejected the event".to_owned());
    }
    let result = response
        .json::<BuzzEventSubmitResponse>()
        .await
        .map_err(|_| "Buzz relay returned an invalid event response".to_owned())?;
    if !result.accepted {
        return Err("Buzz relay did not accept the event".to_owned());
    }
    Ok(())
}

fn validate_buzz_event_author(signer: &nostr::Keys, event: &NostrEvent) -> Result<(), String> {
    if event.pubkey == signer.public_key() {
        Ok(())
    } else {
        Err("Buzz event author does not match its publishing identity".to_owned())
    }
}

#[derive(Clone)]
struct PreparedBuzzLaunch {
    relay: String,
    connection_id: String,
    owner_signer: OwnerSigner,
    owner_keys: nostr::Keys,
    agent_keys: nostr::Keys,
    agent_public_hex: String,
    agent_npub: String,
    agent_nsec: SecretString,
    auth_tag: SecretString,
    channels: Vec<String>,
    enrollment_events: Vec<NostrEvent>,
    removal_events: Vec<NostrEvent>,
}

fn prepare_buzz_launch(input: &BuzzCreateInput) -> Result<PreparedBuzzLaunch, String> {
    validate_buzz_input(input)?;
    let connection_id = input.connection_id.trim();
    if connection_id.is_empty() {
        return Err("Choose a saved Buzz connection".to_owned());
    }
    let repository = buzz_connection_repository()?;
    let document = repository.load().map_err(|error| error.to_string())?;
    let connection = document
        .connections
        .iter()
        .find(|connection| connection.id == connection_id)
        .ok_or_else(|| "Saved Buzz connection not found".to_owned())?;
    let owner = repository
        .owner_signer(connection_id)
        .map_err(|error| error.to_string())?;
    let agent = AgentIdentity::generate();
    let auth_tag = build_owner_attestation(&owner, &agent.public_key(), "")
        .map_err(|error| error.to_string())?;
    let mut channels = input
        .channels
        .iter()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    channels.sort();
    channels.dedup();
    let mut enrollment_events = Vec::new();
    let mut removal_events = Vec::new();
    for channel in &channels {
        enrollment_events.push(
            build_bot_enrollment_event(&owner, channel, &agent.public_key())
                .map_err(|error| error.to_string())?,
        );
        removal_events.push(
            build_bot_removal_event(&owner, channel, &agent.public_key())
                .map_err(|error| error.to_string())?,
        );
    }
    Ok(PreparedBuzzLaunch {
        relay: connection.relay_url.clone(),
        connection_id: connection.id.clone(),
        owner_signer: owner.clone(),
        owner_keys: owner.keys(),
        agent_keys: agent.keys(),
        agent_public_hex: agent.public_hex(),
        agent_npub: agent.npub().map_err(|error| error.to_string())?,
        agent_nsec: agent.private_nsec().map_err(|error| error.to_string())?,
        auth_tag,
        channels,
        enrollment_events,
        removal_events,
    })
}

fn wait_for_stopped(client: &HyperCliClient, deployment: Deployment) -> Result<Deployment, String> {
    if deployment.state.trim().eq_ignore_ascii_case("stopped") {
        return Ok(deployment);
    }
    tauri::async_runtime::block_on(client.wait_deployment_state(
        &deployment.id,
        &["stopped"],
        &[],
        Duration::from_secs(120),
    ))
    .map_err(|error| error.to_string())
}

fn create_buzz_deployment_blocking(
    input: &BuzzCreateInput,
    prepared: &PreparedBuzzLaunch,
) -> Result<(Deployment, u32), String> {
    let runtime = parse_buzz_runtime(&input.runtime)?;
    let client = managed_client()?;
    let requested_size = match parse_buzz_size(input.size.as_deref())? {
        Some(size) => size,
        None => client
            .list_deployments_with_capacity()
            .map_err(|error| error.to_string())?
            .largest_available_size()
            .ok_or_else(|| "No HyperCLI agent slot is currently available".to_owned())?,
    };
    let parallelism = input.concurrency.unwrap_or(match requested_size {
        AgentSize::Small => 2,
        AgentSize::Medium => 5,
        AgentSize::Large => 10,
    });
    let mut request = CreateDeploymentRequest::new(runtime);
    request.name = Some(canonical_deployment_name(
        input.name.trim(),
        &prepared.agent_public_hex,
    ));
    let model = input
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let mut buzz = BuzzLaunchConfig::new(
        prepared.agent_nsec.expose_secret().to_owned(),
        prepared.relay.clone(),
    );
    buzz.auth_tag = Some(prepared.auth_tag.expose_secret().to_owned());
    buzz.system_prompt = Some(
        input
            .instructions
            .as_deref()
            .unwrap_or("")
            .trim()
            .to_owned(),
    );
    buzz.model = model.map(str::to_owned);
    buzz.parallelism = parallelism;
    buzz.respond_to = Some(input.respond_to.trim().to_owned());
    buzz.respond_to_allowlist = input
        .allowlist
        .iter()
        .map(|value| value.trim().to_owned())
        .collect();
    buzz.display_name = Some(input.name.trim().to_owned());
    buzz.apply_to(&mut request, Some(input.name.trim()))
        .map_err(|error| error.to_string())?;
    request.size = Some(requested_size);
    request.mark_buzz_deployment(Some(&prepared.agent_public_hex));
    for channel in &prepared.channels {
        request.tags.push(format!("buzz_channel={channel}"));
    }
    let deployment = client
        .create_deployment(&request)
        .map_err(|error| error.to_string())?;
    // CREATE provisions only. Keep the runtime stopped until its Buzz profile
    // and local ownership record have been installed.
    wait_for_stopped(&client, deployment).map(|deployment| (deployment, parallelism))
}

/// Relay retraction plan for a deleted Buzz deployment: the managed-agent
/// tombstone plus per-channel bot removals, all owner-signed.
pub(crate) struct BuzzAgentRemoval {
    relay: String,
    owner_keys: nostr::Keys,
    events: Vec<NostrEvent>,
}

/// Build the retraction plan for a deployment that is about to be deleted.
/// Returns `None` for non-Buzz deployments (no local Buzz ownership record).
pub(crate) fn prepare_buzz_agent_removal(
    deployment_id: &str,
) -> Result<Option<BuzzAgentRemoval>, String> {
    let repository = buzz_connection_repository()?;
    let document = repository.load().map_err(|error| error.to_string())?;
    let Some(agent) = document
        .agents
        .iter()
        .find(|candidate| candidate.deployment_id.as_deref() == Some(deployment_id))
    else {
        return Ok(None);
    };
    let connection = document
        .connections
        .iter()
        .find(|candidate| candidate.id == agent.connection_id)
        .ok_or_else(|| "Saved Buzz connection not found".to_owned())?;
    let owner = repository
        .owner_signer(&agent.connection_id)
        .map_err(|error| error.to_string())?;
    let agent_public_key = nostr::PublicKey::from_hex(&agent.agent_public_hex)
        .map_err(|_| "Stored Buzz agent identity is invalid".to_owned())?;
    // Tombstone first: the directory entry is the highest-visibility artifact
    // and the publish loop aborts on the first failure.
    let mut events = vec![build_managed_agent_removal_event(&owner, &agent_public_key)
        .map_err(|error| error.to_string())?];
    for channel in &agent.channels {
        events.push(
            build_bot_removal_event(&owner, &channel.id, &agent_public_key)
                .map_err(|error| error.to_string())?,
        );
    }
    Ok(Some(BuzzAgentRemoval {
        relay: connection.relay_url.clone(),
        owner_keys: owner.keys(),
        events,
    }))
}

/// Publish the retraction and drop the local Buzz ownership record. Runs after
/// the backend deployment is gone; a publish failure keeps the local record so
/// the retraction can be retried.
pub(crate) async fn retract_buzz_agent(
    removal: BuzzAgentRemoval,
    deployment_id: &str,
) -> Result<(), String> {
    publish_buzz_events(&removal.relay, removal.owner_keys, &removal.events).await?;
    let deployment_id = deployment_id.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        buzz_connection_repository()?
            .forget_agent_by_deployment(&deployment_id)
            .map(|_| ())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn cleanup_created_deployment_blocking(agent_id: String) -> Result<(), String> {
    let agent_id = checked_agent_id(&agent_id)?;
    let client = managed_client()?;
    let mut deployment = client
        .get_deployment(&agent_id)
        .map_err(|error| error.to_string())?;
    if !deployment.state.trim().eq_ignore_ascii_case("stopped") {
        deployment = client
            .stop_deployment(&agent_id)
            .map_err(|error| error.to_string())?;
        wait_for_stopped(&client, deployment)?;
    }
    let deleted = client
        .delete_deployment(&agent_id)
        .map_err(|error| error.to_string())?;
    if deleted.ok && deleted.id == agent_id {
        Ok(())
    } else {
        Err("Backend did not confirm cleanup of the new agent".to_owned())
    }
}

/// Create a Buzz agent: generate the agent's Nostr identity locally, create
/// the deployment, publish the profile + enrollment events, record ownership
/// locally, then start. Any failure after creation tears the deployment down
/// and publishes the removal events.
#[tauri::command]
pub async fn create_buzz_agent(input: BuzzCreateInput) -> Result<LauncherAgent, String> {
    let validated_model = tauri::async_runtime::spawn_blocking({
        let model = input.model.clone();
        move || resolve_launch_model_blocking(model.as_deref())
    })
    .await
    .map_err(|error| error.to_string())??;
    let mut input = input;
    input.model = validated_model;
    let prepared = tauri::async_runtime::spawn_blocking({
        let prepare_input = input.clone();
        move || prepare_buzz_launch(&prepare_input)
    })
    .await
    .map_err(|error| error.to_string())??;
    if input.respond_to.trim() == "allowlist" {
        input.allowlist = resolve_buzz_allowlist(
            &prepared.relay,
            prepared.owner_keys.clone(),
            &prepared.channels,
            &input.allowlist,
        )
        .await?;
    } else {
        input.allowlist.clear();
    }
    let (deployment, parallelism) = tauri::async_runtime::spawn_blocking({
        let prepared = prepared.clone();
        let launch_input = input.clone();
        move || create_buzz_deployment_blocking(&launch_input, &prepared)
    })
    .await
    .map_err(|error| error.to_string())??;

    // Owner-signed managed-agent definition (kind 30177) plus its NIP-09
    // tombstone. The definition rides with the enrollment batch so the agent
    // appears in the shared Buzz directory right after its profile publish;
    // the tombstone rides with the removal events so cleanup and uninstall
    // also retract the directory entry.
    let managed_agent_event = build_managed_agent_event(
        &prepared.owner_signer,
        &prepared.agent_keys.public_key(),
        &ManagedAgentProjection {
            name: input.name.trim(),
            system_prompt: input.instructions.as_deref(),
            model: input.model.as_deref(),
            parallelism,
            respond_to: input.respond_to.trim(),
            respond_to_allowlist: &input.allowlist,
        },
    )
    .map_err(|error| error.to_string())?;
    let managed_agent_removal = build_managed_agent_removal_event(
        &prepared.owner_signer,
        &prepared.agent_keys.public_key(),
    )
    .map_err(|error| error.to_string())?;
    let mut enrollment_events = prepared.enrollment_events.clone();
    enrollment_events.push(managed_agent_event);
    // Tombstone first: the directory entry is the highest-visibility artifact
    // and the publish loop aborts on the first failure.
    let mut removal_events = vec![managed_agent_removal];
    removal_events.extend(prepared.removal_events.iter().cloned());

    let profile_identity =
        AgentIdentity::from_nsec(&prepared.agent_nsec).map_err(|error| error.to_string())?;
    let profile_event = build_agent_profile_event(
        &profile_identity,
        input.name.trim(),
        None,
        Some(input.instructions.as_deref().unwrap_or("").trim()),
        &prepared.auth_tag,
    )
    .map_err(|error| error.to_string())?;
    let profile_result = publish_signed_buzz_event_http(
        &prepared.relay,
        &prepared.agent_keys,
        &profile_event,
        Some(&prepared.auth_tag),
    )
    .await;
    let publish_result = match profile_result {
        Ok(()) => {
            publish_buzz_events(
                &prepared.relay,
                prepared.owner_keys.clone(),
                &enrollment_events,
            )
            .await
        }
        Err(error) => Err(error),
    };
    if let Err(error) = publish_result {
        let cleanup_id = deployment.id.clone();
        let backend_cleanup = tauri::async_runtime::spawn_blocking(move || {
            cleanup_created_deployment_blocking(cleanup_id)
        })
        .await
        .map_err(|join_error| join_error.to_string())?;
        let relay_cleanup = publish_buzz_events(
            &prepared.relay,
            prepared.owner_keys.clone(),
            &removal_events,
        )
        .await;
        let mut failures = vec![error];
        if let Err(cleanup_error) = backend_cleanup {
            failures.push(format!("backend cleanup failed: {cleanup_error}"));
        }
        if let Err(cleanup_error) = relay_cleanup {
            failures.push(format!("Buzz cleanup failed: {cleanup_error}"));
        }
        return Err(failures.join("; "));
    }

    if let Err(error) = open_owner_dm_with_greeting(&prepared, input.name.trim()).await {
        eprintln!("hypercli-menubar: owner DM on launch failed: {error}");
    }

    let metadata = ManagedBuzzAgentMetadata {
        agent_public_hex: prepared.agent_public_hex.clone(),
        agent_npub: prepared.agent_npub.clone(),
        connection_id: prepared.connection_id.clone(),
        channels: prepared
            .channels
            .iter()
            .cloned()
            .map(|id| crate::buzz_connections::ChannelReference {
                name: id.clone(),
                id,
            })
            .collect(),
        deployment_id: Some(deployment.id.clone()),
        runtime: input.runtime.clone(),
        tags: BTreeMap::from([("app".to_owned(), "buzz".to_owned())]),
    };
    let record_result = tauri::async_runtime::spawn_blocking(move || {
        buzz_connection_repository()?
            .record_agent(metadata)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?;
    if let Err(record_error) = record_result {
        let cleanup_id = deployment.id.clone();
        let cleanup = tauri::async_runtime::spawn_blocking(move || {
            cleanup_created_deployment_blocking(cleanup_id)
        })
        .await
        .map_err(|error| error.to_string())?;
        let relay_cleanup = publish_buzz_events(
            &prepared.relay,
            prepared.owner_keys.clone(),
            &removal_events,
        )
        .await;
        let mut failures = vec![format!(
            "Could not save local Buzz metadata: {record_error}"
        )];
        if let Err(error) = cleanup {
            failures.push(format!("backend cleanup failed: {error}"));
        }
        if let Err(error) = relay_cleanup {
            failures.push(format!("Buzz cleanup failed: {error}"));
        }
        return Err(failures.join("; "));
    }
    let started_id = deployment.id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let client = managed_client()?;
        let launch_config = client
            .stored_launch_config(&started_id, None)
            .map_err(|error| error.to_string())?;
        client
            .start_deployment(&started_id, &StartDeploymentRequest::new(launch_config))
            .map(LauncherAgent::from)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}
