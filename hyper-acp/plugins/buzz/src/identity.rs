//! Multi-identity runtime registry (spike, feature-flagged).
//!
//! When `BUZZ_ACP_AGENTS_FILE` points at a TOML `[[agents]]` file (see
//! [`crate::config::load_agent_identities`]), the harness runs N logical
//! identities over the same agent child processes. This module holds the
//! per-identity runtime surface built once at startup:
//!
//! - [`IdentityRuntime::publish_handle`] — the identity's signing keys plus
//!   its **own** publish journal, installed on each turn bound to one of the
//!   identity's channels. Separate journals (rather than one journal keyed by
//!   agent id) make cross-identity reply-guard suppression impossible by
//!   construction: identity A's publish can never mark identity B's channel
//!   journal.
//! - [`IdentityRuntime::mcp_bridge`] — one loopback MCP bridge **per
//!   identity**. Because each bridge owns an independent token registry, a
//!   session token resolves to exactly one (identity, channel) pair without
//!   widening `mcp_bridge`'s registry value type.
//!
//! Channel routing is by disjoint `channels` lists validated at config load:
//! every `SessionScope` maps to exactly one identity via its channel id, so
//! per-scope state (sessions, delivery ledgers, turn counts) needs no
//! explicit agent id in this spike.
//!
//! When no agents file is configured the harness builds no `IdentitySet` and
//! every selection helper on [`crate::pool::PromptContext`] falls through to
//! the single-identity `publish_handle` / `mcp_bridge` — behavior is
//! byte-identical to a single-agent launch.

use std::collections::HashMap;
use std::sync::Arc;

use uuid::Uuid;

/// One logical agent identity and its publish surfaces.
pub(crate) struct IdentityRuntime {
    /// Stable identifier from the agents file (`[[agents]].id`). Log-only;
    /// never used as key material. Read by tests and startup logs.
    #[allow(dead_code)] // Logged at build; future per-task attribution.
    pub(crate) id: String,
    /// The identity's resolved signing keys. Held by the plugin only —
    /// agent children never receive them (`acp::CHILD_SECRET_ENV_KEYS` plus
    /// the registered `private_key_ref` env vars are stripped at spawn).
    pub(crate) keys: nostr::Keys,
    /// Optional owner pubkey (64-char hex) declared by the file. Carried for
    /// downstream per-identity owner features; not consulted by the publish
    /// path in this spike.
    #[allow(dead_code)] // Declared config surface; publish routing does not read it yet.
    pub(crate) owner: Option<String>,
    /// Blind-signing handle (keys + relay publisher + private journal) for
    /// the `buzz/publish` ACP method and the turn-end reply guard.
    pub(crate) publish_handle: crate::publish::PublisherHandle,
    /// The identity's loopback MCP bridge. `None` when the listener failed
    /// to bind (mirrors the single-identity degradation: the `buzz` MCP tool
    /// is disabled but `buzz/publish` remains available).
    pub(crate) mcp_bridge: Option<Arc<crate::mcp_bridge::McpBridge>>,
}

/// All configured identities plus the channel → identity index.
///
/// Built once at startup; immutable afterwards (queries only).
pub(crate) struct IdentitySet {
    /// Identities in file order. Insertion order is stable so startup logs
    /// and summaries read deterministically.
    identities: Vec<IdentityRuntime>,
    /// channel id → index into `identities`. Disjointness is proven at
    /// config-load time; construction assumes it (fail-fast there).
    by_channel: HashMap<Uuid, usize>,
}

impl IdentitySet {
    /// Build the runtime for every configured identity: one private publish
    /// journal per identity (shared by that identity's two publish surfaces)
    /// and one MCP bridge per identity. A bridge that fails to bind degrades
    /// to `None` with a warning, matching the single-identity startup path.
    pub(crate) async fn build(
        identities: Vec<crate::config::AgentIdentity>,
        publisher: crate::relay::RelayEventPublisher,
    ) -> Self {
        let mut runtimes = Vec::with_capacity(identities.len());
        let mut by_channel = HashMap::new();
        for (index, identity) in identities.into_iter().enumerate() {
            let journal: crate::publish::PublishJournal = Default::default();
            let publish_handle = crate::publish::PublisherHandle::with_journal(
                identity.keys.clone(),
                publisher.clone(),
                journal.clone(),
            );
            // Per-identity bridges carry no attachment context in this spike:
            // attachment publishing stays on the connected identity's bridge.
            let mcp_bridge = match crate::mcp_bridge::McpBridge::start_with_attachments(
                identity.keys.clone(),
                publisher.clone(),
                journal,
                None,
            )
            .await
            {
                Ok(bridge) => Some(Arc::new(bridge)),
                Err(e) => {
                    tracing::warn!(
                        agent_id = %identity.id,
                        "buzz MCP bridge listener failed to bind for identity ({e}); \
                         its `buzz` publish MCP tool is disabled — buzz/publish remains available"
                    );
                    None
                }
            };
            for channel in &identity.channels {
                by_channel.insert(*channel, index);
            }
            tracing::info!(
                agent_id = %identity.id,
                pubkey = %identity.keys.public_key().to_hex(),
                channels = identity.channels.len(),
                mcp_bridge = mcp_bridge.is_some(),
                "multi-agent identity ready (publish + bridge surfaces)"
            );
            runtimes.push(IdentityRuntime {
                id: identity.id,
                keys: identity.keys,
                owner: identity.owner,
                publish_handle,
                mcp_bridge,
            });
        }
        Self {
            identities: runtimes,
            by_channel,
        }
    }

    /// The identity that owns `channel`, if any.
    pub(crate) fn for_channel(&self, channel: Uuid) -> Option<&IdentityRuntime> {
        self.by_channel
            .get(&channel)
            .map(|idx| &self.identities[*idx])
    }

    /// Number of configured identities.
    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.identities.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity_spec(channels: &[Uuid]) -> crate::config::AgentIdentity {
        crate::config::AgentIdentity {
            id: format!("agent-{}", channels.len()),
            keys: nostr::Keys::generate(),
            owner: None,
            channels: channels.iter().copied().collect(),
        }
    }

    #[tokio::test]
    async fn identity_set_routes_by_disjoint_channel_and_shares_no_journal() {
        let channel_a = Uuid::new_v4();
        let channel_b = Uuid::new_v4();
        let unlisted = Uuid::new_v4();
        let spec_a = identity_spec(&[channel_a]);
        let spec_b = identity_spec(&[channel_b]);
        let key_a = spec_a.keys.public_key();
        let key_b = spec_b.keys.public_key();
        let (publisher, _rx) = crate::relay::RelayEventPublisher::test_pair();

        let set = IdentitySet::build(vec![spec_a, spec_b], publisher).await;

        assert_eq!(set.len(), 2);
        assert_eq!(set.for_channel(channel_a).unwrap().keys.public_key(), key_a);
        assert_eq!(set.for_channel(channel_b).unwrap().keys.public_key(), key_b);
        assert!(
            set.for_channel(unlisted).is_none(),
            "unlisted channels resolve to no identity"
        );
        // Journal isolation: the two identities must not share a journal —
        // otherwise one identity's successful publish could suppress the
        // other's reply-guard fallback on the same channel.
        let journal_a = set
            .for_channel(channel_a)
            .unwrap()
            .publish_handle
            .journal
            .clone();
        let journal_b = set
            .for_channel(channel_b)
            .unwrap()
            .publish_handle
            .journal
            .clone();
        assert!(
            !std::sync::Arc::ptr_eq(&journal_a, &journal_b),
            "each identity owns a private publish journal"
        );
        // Each identity got its own bridge (token registries are per-bridge).
        let bridge_a = set
            .for_channel(channel_a)
            .unwrap()
            .mcp_bridge
            .as_ref()
            .unwrap();
        let bridge_b = set
            .for_channel(channel_b)
            .unwrap()
            .mcp_bridge
            .as_ref()
            .unwrap();
        assert!(
            !std::sync::Arc::ptr_eq(bridge_a, bridge_b),
            "each identity owns a private MCP bridge/registry"
        );
    }
}
