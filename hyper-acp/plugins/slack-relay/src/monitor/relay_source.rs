//! OpenClaw `monitor/relay-source.ts` equivalent.

pub use crate::relay_source::{
    build_relay_ack, build_relay_websocket_options, build_relay_websocket_url, extract_relay_hello,
    extract_relay_slack_message_event, format_relay_close, parse_relay_frame,
    RelayWebSocketOptions, SlackRelayAcceptedEvent, SlackRelayAckFrame, SlackRelayError,
    SlackRelayHello, SlackRelayIdentity, SlackRelayRoute, SlackRelayRouteKind,
    SlackRelaySourceConfig, HYPER_AGENTS_API_KEY_ENV, SLACK_RELAY_HANDSHAKE_TIMEOUT_MS,
    SLACK_RELAY_MAX_PAYLOAD_BYTES,
};
