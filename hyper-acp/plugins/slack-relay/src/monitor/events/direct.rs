//! Direct Slack Events API adapter.
//!
//! Provenance:
//! - `openclaw-git/extensions/slack/src/monitor/events.ts` for routing direct
//!   Slack events into the monitor event families.
//! - `openclaw-git/extensions/slack/src/monitor/events/messages.ts` for the
//!   message/app_mention path used by the shared core pipeline.
//!
//! Rust deviation: this module exposes pure parsing/conversion helpers so a
//! HyperCLI HTTP or Socket Mode host can feed direct Slack events without Bolt.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::monitor::events::messages::{
    normalize_slack_event, SlackAcceptedEvent, SlackAcceptedEventTransport,
};
use crate::relay_source::{SlackRelayRoute, SlackRelayRouteKind};

/// Parsed direct Slack Events API envelope.
#[derive(Debug, Clone, PartialEq)]
pub enum SlackDirectEventEnvelope {
    /// Slack URL verification challenge.
    UrlVerification {
        /// Challenge string to echo to Slack.
        challenge: String,
    },
    /// Slack event callback carrying an event object.
    EventCallback {
        /// Team id.
        team_id: Option<String>,
        /// API app id.
        api_app_id: Option<String>,
        /// Event id.
        event_id: Option<String>,
        /// Inner event object.
        event: Value,
        /// Full envelope.
        payload: Value,
    },
}

/// Parsed Slack Socket Mode `events_api` frame.
#[derive(Debug, Clone, PartialEq)]
pub struct SlackSocketModeEventFrame {
    /// Socket Mode envelope id to ack.
    pub envelope_id: String,
    /// Slack Events API payload.
    pub payload: Value,
}

/// Parsed Slack Socket Mode frame that requires an ack.
#[derive(Debug, Clone, PartialEq)]
pub enum SlackSocketModeFrame {
    /// Events API callback envelope.
    EventsApi {
        /// Socket Mode envelope id to ack.
        envelope_id: String,
        /// Slack Events API payload.
        payload: Value,
    },
    /// Slack interaction envelope.
    Interactive {
        /// Socket Mode envelope id to ack.
        envelope_id: String,
        /// Slack interaction payload.
        payload: Value,
    },
}

impl SlackSocketModeFrame {
    /// Envelope id to ack.
    #[must_use]
    pub fn envelope_id(&self) -> &str {
        match self {
            Self::EventsApi { envelope_id, .. } | Self::Interactive { envelope_id, .. } => {
                envelope_id
            }
        }
    }

    /// Inner Slack payload.
    #[must_use]
    pub fn payload(&self) -> &Value {
        match self {
            Self::EventsApi { payload, .. } | Self::Interactive { payload, .. } => payload,
        }
    }
}

/// Socket Mode ack frame.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[must_use]
pub struct SlackSocketModeAck {
    /// Envelope id.
    pub envelope_id: String,
    /// Optional payload for interactive ack responses.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
}

/// Parses a direct Slack Events API envelope.
#[must_use]
pub fn parse_direct_slack_event_envelope(payload: &Value) -> Option<SlackDirectEventEnvelope> {
    let record = payload.as_object()?;
    match record.get("type")?.as_str()? {
        "url_verification" => Some(SlackDirectEventEnvelope::UrlVerification {
            challenge: record.get("challenge")?.as_str()?.to_owned(),
        }),
        "event_callback" => Some(SlackDirectEventEnvelope::EventCallback {
            team_id: record
                .get("team_id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            api_app_id: record
                .get("api_app_id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            event_id: record
                .get("event_id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            event: record.get("event")?.clone(),
            payload: payload.clone(),
        }),
        _ => None,
    }
}

/// Converts a direct Slack Events API callback to the shared accepted-event
/// shape used by provider mode and the message handler.
#[must_use]
pub fn direct_event_to_accepted_event(payload: &Value) -> Option<SlackAcceptedEvent> {
    let SlackDirectEventEnvelope::EventCallback {
        team_id,
        api_app_id: _,
        event_id,
        event,
        payload,
    } = parse_direct_slack_event_envelope(payload)?
    else {
        return None;
    };
    let normalized = normalize_slack_event(&event, team_id.as_deref())?;
    let channel = normalized
        .message
        .get("channel")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_owned();
    let ts = normalized
        .message
        .get("ts")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_owned();
    Some(SlackAcceptedEvent {
        transport: SlackAcceptedEventTransport::DirectHttp,
        delivery_id: event_id.unwrap_or_else(|| format!("direct:{channel}:{ts}")),
        team_id: normalized.team_id,
        message: normalized.message,
        payload,
        route: SlackRelayRoute {
            kind: SlackRelayRouteKind::ThreadAffinity,
            key: format!("{channel}:{ts}"),
        },
    })
}

/// Parses a Slack Socket Mode `events_api` envelope.
#[must_use]
pub fn parse_socket_mode_event_frame(frame: &Value) -> Option<SlackSocketModeEventFrame> {
    let SlackSocketModeFrame::EventsApi {
        envelope_id,
        payload,
    } = parse_socket_mode_frame(frame)?
    else {
        return None;
    };
    Some(SlackSocketModeEventFrame {
        envelope_id,
        payload,
    })
}

/// Parses Socket Mode frames that require an ack.
#[must_use]
pub fn parse_socket_mode_frame(frame: &Value) -> Option<SlackSocketModeFrame> {
    let record = frame.as_object()?;
    let envelope_id = record.get("envelope_id")?.as_str()?.to_owned();
    let payload = record.get("payload")?.clone();
    match record.get("type")?.as_str()? {
        "events_api" => Some(SlackSocketModeFrame::EventsApi {
            envelope_id,
            payload,
        }),
        "interactive" => Some(SlackSocketModeFrame::Interactive {
            envelope_id,
            payload,
        }),
        _ => None,
    }
}

/// Converts a Socket Mode `events_api` frame into the same accepted-event shape
/// used by HTTP Events API and relay mode.
#[must_use]
pub fn socket_mode_frame_to_accepted_event(frame: &Value) -> Option<SlackAcceptedEvent> {
    let socket = parse_socket_mode_event_frame(frame)?;
    let mut event = direct_event_to_accepted_event(&socket.payload)?;
    event.delivery_id = socket.envelope_id;
    event.transport = SlackAcceptedEventTransport::DirectSocket;
    Some(event)
}

/// Builds a Slack Socket Mode ack frame.
#[must_use = "Socket Mode acks must be returned to Slack"]
pub fn build_socket_mode_ack(envelope_id: &str) -> SlackSocketModeAck {
    SlackSocketModeAck {
        envelope_id: envelope_id.to_owned(),
        payload: None,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn parses_url_verification() {
        assert_eq!(
            parse_direct_slack_event_envelope(&json!({
                "type":"url_verification",
                "challenge":"abc"
            })),
            Some(SlackDirectEventEnvelope::UrlVerification {
                challenge: "abc".to_owned()
            })
        );
    }

    #[test]
    fn direct_event_callback_feeds_shared_accepted_event_shape() {
        let event = direct_event_to_accepted_event(&json!({
            "type":"event_callback",
            "team_id":"T1",
            "api_app_id":"A1",
            "event_id":"Ev1",
            "event":{"type":"app_mention","channel":"C1","user":"U1","text":"<@B1> hi","ts":"100.1"}
        }))
        .unwrap();
        assert_eq!(event.delivery_id, "Ev1");
        assert_eq!(event.transport, SlackAcceptedEventTransport::DirectHttp);
        assert_eq!(event.team_id.as_deref(), Some("T1"));
        assert_eq!(event.message["type"], "app_mention");
        assert_eq!(event.route.key, "C1:100.1");
    }

    #[test]
    fn socket_mode_events_feed_shared_accepted_event_shape_and_ack() {
        let event = socket_mode_frame_to_accepted_event(&json!({
            "type":"events_api",
            "envelope_id":"Env1",
            "payload":{
                "type":"event_callback",
                "team_id":"T1",
                "event":{"type":"message","channel":"C1","user":"U1","text":"hi","ts":"101.1"}
            }
        }))
        .unwrap();
        assert_eq!(event.delivery_id, "Env1");
        assert_eq!(event.transport, SlackAcceptedEventTransport::DirectSocket);
        assert_eq!(event.message["channel"], "C1");
        assert_eq!(build_socket_mode_ack("Env1").envelope_id, "Env1");
    }
}
