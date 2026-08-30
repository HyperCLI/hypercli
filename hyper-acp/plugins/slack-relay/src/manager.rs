//! Relay manager queue, ack, reconnect, and shutdown state.
//!
//! Provenance: `hyperclaw-backend/slack-relay/app/relay.py`
//! `OpenClawConnection` queue/ack/health lines 58-103, register replacement
//! and pending drain lines 105-132, client ack handling lines 174-181, deliver
//! pending bucket lines 183-196, sweep/close-all lines 201-252.

use std::collections::{HashMap, VecDeque};

use crate::routing::OpenClawRelaySlackEventFrame;

/// Queue capacity from HyperCLI backend.
pub const RELAY_QUEUE_CAPACITY: usize = 100;
/// Shutdown close code from HyperCLI backend.
pub const SERVER_SHUTDOWN_CLOSE_CODE: u16 = 1001;
/// Shutdown reason from HyperCLI backend.
pub const SERVER_SHUTDOWN_REASON: &str = "server_shutdown";
/// Replacement reason from HyperCLI backend.
pub const REPLACED_REASON: &str = "replaced";

/// Queued relay message.
#[derive(Debug, Clone, PartialEq)]
pub struct QueuedRelayMessage {
    /// Frame.
    pub frame: OpenClawRelaySlackEventFrame,
    /// Expiry epoch seconds.
    pub expires_at: f64,
}

/// Connection state.
#[derive(Debug, Clone, PartialEq)]
pub struct RelayConnectionState {
    /// Gateway id.
    pub gateway_id: String,
    /// Runtime.
    pub runtime: String,
    /// Queue.
    pub queue: VecDeque<QueuedRelayMessage>,
    /// Connected-at epoch seconds.
    pub connected_at: f64,
    /// Last client frame time.
    pub last_client_frame_at: f64,
    /// Last ack time.
    pub last_ack_at: Option<f64>,
}

/// Close intent returned by pure state operations.
#[derive(Debug, Clone, PartialEq)]
pub struct RelayCloseIntent {
    /// Gateway id.
    pub gateway_id: String,
    /// Close code.
    pub code: u16,
    /// Close reason.
    pub reason: String,
}

/// Relay manager state.
#[derive(Debug, Clone)]
pub struct RelayManagerState {
    connections: HashMap<String, RelayConnectionState>,
    pending: HashMap<String, Vec<QueuedRelayMessage>>,
    ttl_seconds: f64,
}

impl RelayManagerState {
    /// Creates manager state.
    #[must_use]
    pub fn new(ttl_seconds: f64) -> Self {
        Self {
            connections: HashMap::new(),
            pending: HashMap::new(),
            ttl_seconds,
        }
    }

    /// Registers a connection, replacing any existing connection and draining non-expired pending frames.
    pub fn register(
        &mut self,
        gateway_id: &str,
        runtime: &str,
        now: f64,
    ) -> Option<RelayCloseIntent> {
        let replaced = self
            .connections
            .remove(gateway_id)
            .map(|old| RelayCloseIntent {
                gateway_id: old.gateway_id,
                code: 1000,
                reason: REPLACED_REASON.to_owned(),
            });
        let mut connection = RelayConnectionState {
            gateway_id: gateway_id.to_owned(),
            runtime: runtime.to_owned(),
            queue: VecDeque::new(),
            connected_at: now,
            last_client_frame_at: now,
            last_ack_at: None,
        };
        for queued in self.pending.remove(gateway_id).unwrap_or_default() {
            if queued.expires_at <= now {
                continue;
            }
            if connection.queue.len() >= RELAY_QUEUE_CAPACITY {
                break;
            }
            connection.queue.push_back(queued);
        }
        self.connections.insert(gateway_id.to_owned(), connection);
        replaced
    }

    /// Delivers a frame or parks it in the pending bucket.
    #[must_use]
    pub fn deliver(&mut self, frame: OpenClawRelaySlackEventFrame, now: f64) -> bool {
        let candidate = frame.route.key.clone();
        let queued = QueuedRelayMessage {
            frame,
            expires_at: now + self.ttl_seconds,
        };
        if let Some(connection) = self.connections.get_mut(&candidate) {
            if connection.queue.len() >= RELAY_QUEUE_CAPACITY {
                return false;
            }
            connection.queue.push_back(queued);
            return true;
        }
        let bucket = self.pending.entry(candidate).or_default();
        bucket.push(queued);
        if bucket.len() > RELAY_QUEUE_CAPACITY {
            let extra = bucket.len() - RELAY_QUEUE_CAPACITY;
            bucket.drain(0..extra);
        }
        false
    }

    /// Marks an ack/client frame.
    pub fn handle_client_ack(&mut self, gateway_id: &str, now: f64) {
        if let Some(connection) = self.connections.get_mut(gateway_id) {
            connection.last_client_frame_at = now;
            connection.last_ack_at = Some(now);
        }
    }

    /// Sweeps expired pending and connected messages.
    pub fn sweep_expired(&mut self, now: f64) -> (usize, usize) {
        let mut dropped_pending = 0;
        for bucket in self.pending.values_mut() {
            let before = bucket.len();
            bucket.retain(|queued| queued.expires_at > now);
            dropped_pending += before - bucket.len();
        }
        let mut dropped_connection = 0;
        for connection in self.connections.values_mut() {
            let before = connection.queue.len();
            connection.queue.retain(|queued| queued.expires_at > now);
            dropped_connection += before - connection.queue.len();
        }
        (dropped_pending, dropped_connection)
    }

    /// Closes all connections and clears pending state.
    #[must_use]
    pub fn close_all(&mut self) -> Vec<RelayCloseIntent> {
        self.pending.clear();
        self.connections
            .drain()
            .map(|(_, connection)| RelayCloseIntent {
                gateway_id: connection.gateway_id,
                code: SERVER_SHUTDOWN_CLOSE_CODE,
                reason: SERVER_SHUTDOWN_REASON.to_owned(),
            })
            .collect()
    }

    /// Returns whether gateway is connected.
    #[must_use]
    pub fn is_connected(&self, gateway_id: &str) -> bool {
        self.connections.contains_key(gateway_id)
    }

    /// Returns connection state.
    #[must_use]
    pub fn connection(&self, gateway_id: &str) -> Option<&RelayConnectionState> {
        self.connections.get(gateway_id)
    }

    /// Returns pending count.
    #[must_use]
    pub fn pending_count(&self, gateway_id: &str) -> usize {
        self.pending.get(gateway_id).map_or(0, Vec::len)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::relay_source::{SlackRelayRoute, SlackRelayRouteKind};

    use super::*;

    fn frame(gateway_id: &str, id: usize) -> OpenClawRelaySlackEventFrame {
        OpenClawRelaySlackEventFrame {
            delivery_id: format!("d{id}"),
            route: SlackRelayRoute {
                kind: SlackRelayRouteKind::ChannelDefault,
                key: gateway_id.to_owned(),
            },
            payload: json!({"event": {"type": "message", "channel": "C1"}}),
        }
    }

    #[test]
    fn offline_delivery_queues_pending_then_register_drains() {
        let mut manager = RelayManagerState::new(10.0);
        assert!(!manager.deliver(frame("agent:abc", 1), 0.0));
        assert_eq!(manager.pending_count("agent:abc"), 1);
        assert!(manager.register("agent:abc", "openclaw", 1.0).is_none());
        assert!(manager.is_connected("agent:abc"));
        assert_eq!(manager.connection("agent:abc").unwrap().queue.len(), 1);
    }

    #[test]
    fn pending_bucket_trims_to_one_hundred() {
        let mut manager = RelayManagerState::new(10.0);
        for id in 0..105 {
            let _ = manager.deliver(frame("agent:abc", id), 0.0);
        }
        assert_eq!(manager.pending_count("agent:abc"), 100);
    }

    #[test]
    fn replacement_and_shutdown_return_close_intents() {
        let mut manager = RelayManagerState::new(10.0);
        assert!(manager.register("agent:abc", "openclaw", 0.0).is_none());
        let replaced = manager.register("agent:abc", "openclaw", 1.0).unwrap();
        assert_eq!(replaced.reason, "replaced");
        let shutdown = manager.close_all();
        assert_eq!(shutdown[0].code, 1001);
        assert_eq!(shutdown[0].reason, "server_shutdown");
    }
}
