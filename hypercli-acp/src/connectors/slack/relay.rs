use futures_util::future::BoxFuture;
use futures_util::{SinkExt, StreamExt};
use http::header::{AUTHORIZATION, SEC_WEBSOCKET_PROTOCOL};
use thiserror::Error;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::Request;
use tokio_tungstenite::tungstenite::protocol::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use url::Url;

use super::config::SlackRelayConfig;
use super::dedupe::{LogicalDedupe, LogicalDedupeDecision};
use super::types::{
    NormalizedSlackTurn, RelayAckFrame, RelayFrame, SlackActivity, SlackMessageEvent,
    SlackReplyTarget, SlackTurnSubmitResult,
};

const MAX_RELAY_FRAME_BYTES: usize = 1024 * 1024;

pub trait ConnectorHost: Send + Sync {
    fn submit_slack_turn<'a>(
        &'a self,
        turn: NormalizedSlackTurn,
    ) -> BoxFuture<'a, Result<SlackTurnSubmitResult, HostError>>;

    fn emit_slack_activity<'a>(&'a self, activity: SlackActivity) -> BoxFuture<'a, ()>;
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
#[error("{message}")]
pub struct HostError {
    pub message: String,
}

impl HostError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

#[derive(Debug, Error)]
pub enum SlackRelayError {
    #[error("Slack relay URL must use ws:// or wss://: {0}")]
    InvalidWebsocketScheme(String),
    #[error("Slack relay URL cannot be converted to a websocket request: {0}")]
    Request(tokio_tungstenite::tungstenite::Error),
    #[error("Slack relay HTTP header is invalid: {0}")]
    Header(http::header::InvalidHeaderValue),
    #[error("Slack relay websocket failed: {0}")]
    WebSocket(tokio_tungstenite::tungstenite::Error),
    #[error("Slack relay frame is too large: {0} bytes")]
    FrameTooLarge(usize),
    #[error("Slack relay received malformed JSON frame: {0}")]
    MalformedFrame(serde_json::Error),
    #[error("Slack relay frame is missing required Slack fields")]
    MissingSlackFields,
}

pub fn relay_websocket_url(config: &SlackRelayConfig) -> Result<Url, SlackRelayError> {
    let mut url = config.relay_url.clone();
    match url.scheme() {
        "ws" | "wss" => {}
        scheme => return Err(SlackRelayError::InvalidWebsocketScheme(scheme.to_owned())),
    }
    url.query_pairs_mut()
        .append_pair("gateway_id", &config.gateway_id);
    Ok(url)
}

pub fn build_relay_websocket_request(
    config: &SlackRelayConfig,
) -> Result<Request<()>, SlackRelayError> {
    let url = relay_websocket_url(config)?;
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(SlackRelayError::Request)?;
    request.headers_mut().insert(
        AUTHORIZATION,
        format!("Bearer {}", config.agents_api_key)
            .parse()
            .map_err(SlackRelayError::Header)?,
    );
    request
        .headers_mut()
        .insert(SEC_WEBSOCKET_PROTOCOL, "json".parse().unwrap());
    Ok(request)
}

pub async fn run_relay_once(
    config: &SlackRelayConfig,
    host: &dyn ConnectorHost,
    dedupe: &mut LogicalDedupe,
) -> Result<(), SlackRelayError> {
    let request = build_relay_websocket_request(config)?;
    let (stream, _) = connect_async(request)
        .await
        .map_err(SlackRelayError::WebSocket)?;
    process_relay_stream(stream, host, dedupe).await
}

async fn process_relay_stream(
    mut stream: WebSocketStream<MaybeTlsStream<TcpStream>>,
    host: &dyn ConnectorHost,
    dedupe: &mut LogicalDedupe,
) -> Result<(), SlackRelayError> {
    while let Some(message) = stream.next().await {
        let message = message.map_err(SlackRelayError::WebSocket)?;
        let Some(frame) = decode_relay_message(message)? else {
            continue;
        };

        if let Some(ack) = handle_relay_frame(host, dedupe, frame).await? {
            let payload = serde_json::to_string(&ack).expect("ack frame serializes");
            stream
                .send(Message::Text(payload.into()))
                .await
                .map_err(SlackRelayError::WebSocket)?;
        }
    }
    Ok(())
}

fn decode_relay_message(message: Message) -> Result<Option<RelayFrame>, SlackRelayError> {
    match message {
        Message::Text(text) => {
            if text.len() > MAX_RELAY_FRAME_BYTES {
                return Err(SlackRelayError::FrameTooLarge(text.len()));
            }
            serde_json::from_str(&text)
                .map(Some)
                .map_err(SlackRelayError::MalformedFrame)
        }
        Message::Binary(bytes) => {
            if bytes.len() > MAX_RELAY_FRAME_BYTES {
                return Err(SlackRelayError::FrameTooLarge(bytes.len()));
            }
            serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(SlackRelayError::MalformedFrame)
        }
        Message::Ping(_) | Message::Pong(_) => Ok(None),
        Message::Close(_) => Ok(None),
        Message::Frame(_) => Ok(None),
    }
}

pub async fn handle_relay_frame(
    host: &dyn ConnectorHost,
    dedupe: &mut LogicalDedupe,
    frame: RelayFrame,
) -> Result<Option<RelayAckFrame>, SlackRelayError> {
    let RelayFrame::SlackEvent {
        delivery_id,
        payload,
        ..
    } = frame
    else {
        host.emit_slack_activity(SlackActivity::new("slack.relay_hello"))
            .await;
        return Ok(None);
    };

    let turn = normalize_turn(&delivery_id, *payload)?;
    match dedupe.check_and_reserve(&turn.logical_dedupe_key) {
        LogicalDedupeDecision::DuplicateAccepted => {
            host.emit_slack_activity(SlackActivity {
                kind: "slack.relay_duplicate_acked",
                delivery_id: Some(delivery_id.clone()),
                message: None,
            })
            .await;
            return Ok(Some(RelayAckFrame::new(delivery_id)));
        }
        LogicalDedupeDecision::DuplicatePending => {
            host.emit_slack_activity(SlackActivity {
                kind: "slack.relay_duplicate_pending",
                delivery_id: Some(delivery_id),
                message: None,
            })
            .await;
            return Ok(None);
        }
        LogicalDedupeDecision::FirstSeen => {}
    }

    let dedupe_key = turn.logical_dedupe_key.clone();
    let submit_result = host.submit_slack_turn(turn).await;
    match submit_result {
        Ok(result) if result.durable => {
            dedupe.commit(&dedupe_key);
            Ok(Some(RelayAckFrame::new(delivery_id)))
        }
        Ok(_) => {
            dedupe.release(&dedupe_key);
            Ok(None)
        }
        Err(error) => {
            dedupe.release(&dedupe_key);
            host.emit_slack_activity(SlackActivity {
                kind: "slack.relay_submit_failed",
                delivery_id: Some(delivery_id),
                message: Some(error.message),
            })
            .await;
            Ok(None)
        }
    }
}

fn normalize_turn(
    delivery_id: &str,
    payload: super::types::SlackEventPayload,
) -> Result<NormalizedSlackTurn, SlackRelayError> {
    if payload.event.event_type != "message" {
        return Err(SlackRelayError::MissingSlackFields);
    }
    let team_id = payload.team_id.unwrap_or_default();
    let channel_id = payload.event.channel.clone();
    let message_ts = slack_message_ts(&payload.event).ok_or(SlackRelayError::MissingSlackFields)?;
    let thread_ts = payload
        .event
        .thread_ts
        .clone()
        .unwrap_or_else(|| message_ts.clone());
    let logical_dedupe_key = format!("slack-message:{team_id}:{channel_id}:{message_ts}");
    let conversation_key = conversation_key(&team_id, &payload.event, &thread_ts);
    let idempotency_key = payload
        .event_id
        .map(|event_id| format!("slack-event:{event_id}"))
        .unwrap_or_else(|| format!("slack-delivery:{delivery_id}"));

    Ok(NormalizedSlackTurn {
        idempotency_key,
        logical_dedupe_key,
        conversation_key,
        reply_target: SlackReplyTarget {
            team_id,
            channel_id,
            thread_ts,
        },
        sender_user_id: payload.event.user.clone(),
        text: payload.event.text.clone().unwrap_or_default(),
        raw_event: payload.event,
    })
}

fn slack_message_ts(event: &SlackMessageEvent) -> Option<String> {
    if let Some(ts) = event.ts.as_ref().filter(|value| !value.is_empty()) {
        return Some(ts.clone());
    }
    event
        .message
        .as_ref()
        .and_then(|message| message.get("ts"))
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn conversation_key(team_id: &str, event: &SlackMessageEvent, thread_ts: &str) -> String {
    if matches!(event.channel_type.as_deref(), Some("im")) {
        let user = event.user.as_deref().unwrap_or("unknown");
        return format!("slack-dm:{team_id}:{user}");
    }
    format!("slack:{team_id}:{}:{thread_ts}", event.channel)
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use futures_util::future::{ready, BoxFuture};
    use serde_json::json;

    use super::*;
    use crate::connectors::slack::types::SlackEventPayload;

    #[derive(Default)]
    struct TestHost {
        durable: bool,
        error: Option<HostError>,
        turns: Arc<Mutex<Vec<NormalizedSlackTurn>>>,
    }

    impl ConnectorHost for TestHost {
        fn submit_slack_turn<'a>(
            &'a self,
            turn: NormalizedSlackTurn,
        ) -> BoxFuture<'a, Result<SlackTurnSubmitResult, HostError>> {
            self.turns.lock().unwrap().push(turn);
            let result = self.error.clone().map_or_else(
                || {
                    Ok(SlackTurnSubmitResult {
                        durable: self.durable,
                        turn_id: Some("turn-1".to_owned()),
                    })
                },
                Err,
            );
            Box::pin(ready(result))
        }

        fn emit_slack_activity<'a>(&'a self, _activity: SlackActivity) -> BoxFuture<'a, ()> {
            Box::pin(ready(()))
        }
    }

    fn slack_event(delivery_id: &str, event_id: Option<&str>) -> RelayFrame {
        RelayFrame::SlackEvent {
            delivery_id: delivery_id.to_owned(),
            payload: Box::new(SlackEventPayload {
                team_id: Some("T1".to_owned()),
                enterprise_id: None,
                event_id: event_id.map(ToOwned::to_owned),
                event: SlackMessageEvent {
                    event_type: "message".to_owned(),
                    subtype: None,
                    channel: "C1".to_owned(),
                    channel_type: Some("channel".to_owned()),
                    user: Some("U1".to_owned()),
                    text: Some("hello".to_owned()),
                    ts: Some("123.456".to_owned()),
                    thread_ts: None,
                    event_ts: None,
                    parent_user_id: None,
                    message: None,
                    previous_message: None,
                    deleted_ts: None,
                    blocks: None,
                    files: None,
                    attachments: None,
                },
            }),
            route: None,
        }
    }

    #[test]
    fn websocket_url_appends_gateway_id() {
        let config = SlackRelayConfig {
            enabled: true,
            agents_api_key: "secret".to_owned(),
            relay_url: Url::parse("wss://api.example.com/slack/ws?existing=1").unwrap(),
            api_url: Url::parse("https://api.example.com/slack/api/").unwrap(),
            gateway_id: "agent:abc".to_owned(),
        };

        assert_eq!(
            relay_websocket_url(&config).unwrap().as_str(),
            "wss://api.example.com/slack/ws?existing=1&gateway_id=agent%3Aabc"
        );
    }

    #[test]
    fn websocket_request_uses_bearer_hyper_agents_api_key() {
        let config = SlackRelayConfig {
            enabled: true,
            agents_api_key: "runtime-key".to_owned(),
            relay_url: Url::parse("wss://api.example.com/slack/ws").unwrap(),
            api_url: Url::parse("https://api.example.com/slack/api/").unwrap(),
            gateway_id: "agent:abc".to_owned(),
        };

        let request = build_relay_websocket_request(&config).unwrap();
        assert_eq!(
            request.headers().get(AUTHORIZATION).unwrap(),
            "Bearer runtime-key"
        );
    }

    #[tokio::test]
    async fn acks_only_after_durable_submit() {
        let host = TestHost {
            durable: true,
            ..TestHost::default()
        };
        let mut dedupe = LogicalDedupe::default();

        let ack = handle_relay_frame(&host, &mut dedupe, slack_event("d1", Some("Ev1")))
            .await
            .unwrap();

        assert_eq!(ack, Some(RelayAckFrame::new("d1")));
        let turns = host.turns.lock().unwrap();
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].idempotency_key, "slack-event:Ev1");
        assert_eq!(turns[0].logical_dedupe_key, "slack-message:T1:C1:123.456");
        assert_eq!(turns[0].conversation_key, "slack:T1:C1:123.456");
        assert_eq!(turns[0].reply_target.thread_ts, "123.456");
    }

    #[tokio::test]
    async fn does_not_ack_when_submit_is_not_durable() {
        let host = TestHost {
            durable: false,
            ..TestHost::default()
        };
        let mut dedupe = LogicalDedupe::default();

        let ack = handle_relay_frame(&host, &mut dedupe, slack_event("d1", Some("Ev1")))
            .await
            .unwrap();

        assert_eq!(ack, None);
    }

    #[tokio::test]
    async fn does_not_ack_when_submit_fails_and_releases_dedupe() {
        let host = TestHost {
            durable: true,
            error: Some(HostError::new("boom")),
            ..TestHost::default()
        };
        let mut dedupe = LogicalDedupe::default();

        let ack = handle_relay_frame(&host, &mut dedupe, slack_event("d1", Some("Ev1")))
            .await
            .unwrap();
        assert_eq!(ack, None);

        let retry_host = TestHost {
            durable: true,
            ..TestHost::default()
        };
        let retry_ack =
            handle_relay_frame(&retry_host, &mut dedupe, slack_event("d2", Some("Ev1")))
                .await
                .unwrap();
        assert_eq!(retry_ack, Some(RelayAckFrame::new("d2")));
    }

    #[tokio::test]
    async fn accepted_logical_duplicate_is_acked_without_resubmitting() {
        let host = TestHost {
            durable: true,
            ..TestHost::default()
        };
        let mut dedupe = LogicalDedupe::default();

        let first = handle_relay_frame(&host, &mut dedupe, slack_event("d1", Some("Ev1")))
            .await
            .unwrap();
        let duplicate = handle_relay_frame(&host, &mut dedupe, slack_event("d2", Some("Ev2")))
            .await
            .unwrap();

        assert_eq!(first, Some(RelayAckFrame::new("d1")));
        assert_eq!(duplicate, Some(RelayAckFrame::new("d2")));
        assert_eq!(host.turns.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn dm_conversation_key_is_user_scoped() {
        let host = TestHost {
            durable: true,
            ..TestHost::default()
        };
        let mut dedupe = LogicalDedupe::default();
        let mut frame = slack_event("d1", None);
        if let RelayFrame::SlackEvent { payload, .. } = &mut frame {
            payload.event.channel = "D1".to_owned();
            payload.event.channel_type = Some("im".to_owned());
        }

        handle_relay_frame(&host, &mut dedupe, frame).await.unwrap();

        let turns = host.turns.lock().unwrap();
        assert_eq!(turns[0].conversation_key, "slack-dm:T1:U1");
    }

    #[test]
    fn relay_frame_preserves_hosted_slack_fields() {
        let frame: RelayFrame = serde_json::from_value(json!({
            "type": "slack_event",
            "delivery_id": "d1",
            "payload": {
                "team_id": "T1",
                "event_id": "Ev1",
                "event": {
                    "type": "message",
                    "channel": "C1",
                    "channel_type": "channel",
                    "user": "U1",
                    "text": "hello",
                    "ts": "1.2",
                    "thread_ts": "1.0",
                    "event_ts": "1.2",
                    "parent_user_id": "U0",
                    "message": { "ts": "1.2" },
                    "previous_message": { "text": "old" },
                    "deleted_ts": "1.2",
                    "blocks": [],
                    "files": [],
                    "attachments": []
                }
            }
        }))
        .unwrap();

        let RelayFrame::SlackEvent { payload, .. } = frame else {
            panic!("expected slack_event");
        };
        assert_eq!(payload.event.thread_ts.as_deref(), Some("1.0"));
        assert!(payload.event.blocks.is_some());
        assert!(payload.event.files.is_some());
        assert!(payload.event.attachments.is_some());
    }
}
