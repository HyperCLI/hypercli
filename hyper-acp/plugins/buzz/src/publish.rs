//! Plugin-terminated publish core: validate, sign, and relay a channel message
//! on behalf of an agent that holds **no** Buzz credentials.
//!
//! Two entry surfaces share this module:
//!
//! - [`ACP_METHOD`] (`buzz/publish`), an agent→client JSON-RPC method handled
//!   in the ACP dispatch loops (`acp.rs`), for adapters that can initiate
//!   extension requests.
//! - The MCP bridge (`mcp_bridge.rs`), which exposes the same build+sign+relay
//!   chain as the `publish` tool of the per-session `buzz` MCP server.
//!
//! Both surfaces converge on [`publish`]: params parse, channel-scope check,
//! `buzz_sdk::build_message` → `sign_with_keys` → [`RelayEventPublisher`]
//! (the same chain used by `setup_mode::publish_setup_nudge`). The agent never
//! sees `BUZZ_PRIVATE_KEY` — only the bound channel id and the relay outcome.

use nostr::{EventId, Keys, PublicKey};
use serde_json::Value;
use uuid::Uuid;

use crate::relay::RelayEventPublisher;

/// Agent→client ACP extension method terminated by this plugin.
pub(crate) const ACP_METHOD: &str = "buzz/publish";

/// Hard cap on message content accepted from an agent. Guards the relay and
/// downstream clients against pathological payloads; well above any legitimate
/// conversational message.
pub(crate) const MAX_CONTENT_BYTES: usize = 32 * 1024;

/// Cap on explicit mention recipients per publish.
pub(crate) const MAX_MENTIONS: usize = 32;

/// Signing + relay access the plugin lends to a publish call.
#[derive(Clone)]
pub(crate) struct PublisherHandle {
    pub keys: Keys,
    pub publisher: RelayEventPublisher,
}

/// Per-turn publish context installed on the ACP client: the signing handle
/// plus the single channel this turn is authorized to publish into.
#[derive(Clone)]
pub(crate) struct PublishTurn {
    pub handle: PublisherHandle,
    pub channel_id: Uuid,
}

/// A validated `buzz/publish` request.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PublishParams {
    /// Channel UUID. Optional on the wire: the MCP tool omits it (the channel
    /// is bound to the session token server-side); the ACP method carries it
    /// and it must match the turn's bound channel.
    pub channel_id: Option<Uuid>,
    pub content: String,
    /// Event to thread the reply under (flat: used as both NIP-10 root and
    /// parent), as 64-char hex.
    pub reply_to: Option<EventId>,
    /// Explicit notification recipients (hex or npub on the wire).
    pub mentions: Vec<PublicKey>,
}

/// Publish failure, mapped to a JSON-RPC error at the transport boundary.
#[derive(Debug, thiserror::Error)]
pub(crate) enum PublishError {
    /// Malformed or out-of-limit params. Caller error.
    #[error("invalid params: {0}")]
    InvalidParams(String),
    /// Well-formed request refused by policy (channel-scope mismatch).
    #[error("publish rejected: {0}")]
    Rejected(String),
    /// Build/sign/relay failure beneath the plugin.
    #[error("publish failed: {0}")]
    Transport(String),
}

impl PublishError {
    /// JSON-RPC error code surfaced to the caller.
    pub(crate) fn code(&self) -> i64 {
        match self {
            Self::InvalidParams(_) => -32602,
            Self::Rejected(_) => -32000,
            Self::Transport(_) => -32603,
        }
    }
}

/// Parse params from either surface. Accepts `channelId`/`channel_id` and
/// `replyTo`/`reply_to` spellings so ACP (camelCase) and MCP (snake_case
/// tool schema) callers share one validator.
pub(crate) fn parse_params(params: &Value) -> Result<PublishParams, PublishError> {
    let invalid = |msg: String| PublishError::InvalidParams(msg);

    let channel_raw = params.get("channelId").or_else(|| params.get("channel_id"));
    let channel_id = match channel_raw {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => {
            Some(Uuid::parse_str(s).map_err(|e| invalid(format!("channelId is not a UUID: {e}")))?)
        }
        Some(_) => return Err(invalid("channelId must be a string UUID".into())),
    };

    let content = match params.get("content") {
        Some(Value::String(s)) => s.clone(),
        Some(_) => return Err(invalid("content must be a string".into())),
        None => return Err(invalid("content is required".into())),
    };
    if content.trim().is_empty() {
        return Err(invalid("content must not be empty".into()));
    }
    if content.len() > MAX_CONTENT_BYTES {
        return Err(invalid(format!(
            "content is {} bytes; max is {MAX_CONTENT_BYTES}",
            content.len()
        )));
    }

    let reply_raw = params.get("replyTo").or_else(|| params.get("reply_to"));
    let reply_to = match reply_raw {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => Some(
            EventId::from_hex(s)
                .map_err(|e| invalid(format!("replyTo is not a 64-char hex event id: {e}")))?,
        ),
        Some(_) => return Err(invalid("replyTo must be a 64-char hex event id".into())),
    };

    let mentions = match params.get("mentions") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(items)) => {
            if items.len() > MAX_MENTIONS {
                return Err(invalid(format!(
                    "{} mentions supplied; max is {MAX_MENTIONS}",
                    items.len()
                )));
            }
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                let Some(s) = item.as_str() else {
                    return Err(invalid(
                        "mentions entries must be hex or npub strings".into(),
                    ));
                };
                out.push(
                    PublicKey::parse(s)
                        .map_err(|e| invalid(format!("invalid mention pubkey {s:?}: {e}")))?,
                );
            }
            out
        }
        Some(_) => return Err(invalid("mentions must be an array of pubkeys".into())),
    };

    Ok(PublishParams {
        channel_id,
        content,
        reply_to,
        mentions,
    })
}

/// Validate scope, build, sign, and relay one kind-9 channel message.
///
/// `allowed_channel` is the channel this turn/session is bound to; a params
/// channel that disagrees is rejected (fail closed), and an absent channel
/// resolves to the bound one.
///
/// Returns the ACP result body: the published event id, the channel, and
/// relay acceptance. `delivery` is labeled honestly: the publisher is a
/// fire-and-forget relay write queue, so `accepted: true` means the event was
/// handed to the relay writer, not that any relay has persisted it.
pub(crate) async fn publish(
    handle: &PublisherHandle,
    params: &PublishParams,
    allowed_channel: Uuid,
) -> Result<Value, PublishError> {
    let channel_id = match params.channel_id {
        Some(id) if id != allowed_channel => {
            return Err(PublishError::Rejected(format!(
                "channel {id} is outside this turn's scope ({allowed_channel})"
            )));
        }
        Some(id) => id,
        None => allowed_channel,
    };

    let thread_ref = params.reply_to.map(|id| buzz_sdk::ThreadRef {
        root_event_id: id,
        parent_event_id: id,
    });
    let mention_hex: Vec<String> = params.mentions.iter().map(PublicKey::to_hex).collect();
    let mention_refs: Vec<&str> = mention_hex.iter().map(String::as_str).collect();

    let builder = buzz_sdk::build_message(
        channel_id,
        &params.content,
        thread_ref.as_ref(),
        &mention_refs,
        false,
        &[],
    )
    .map_err(|e| PublishError::Transport(format!("build error: {e}")))?;

    let signed = builder
        .sign_with_keys(&handle.keys)
        .map_err(|e| PublishError::Transport(format!("sign error: {e}")))?;
    let event_id = signed.id.to_hex();

    handle
        .publisher
        .publish_event(signed)
        .await
        .map_err(|e| PublishError::Transport(format!("relay publish error: {e}")))?;

    Ok(serde_json::json!({
        "eventId": event_id,
        "channelId": channel_id.to_string(),
        "accepted": true,
        "delivery": "relay-write-queue",
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::nip10;
    use nostr::Kind;

    fn test_handle() -> (PublisherHandle, tokio::sync::mpsc::Receiver<nostr::Event>) {
        let (publisher, rx) = RelayEventPublisher::test_pair();
        (
            PublisherHandle {
                keys: Keys::generate(),
                publisher,
            },
            rx,
        )
    }

    fn params_json(content: &str) -> Value {
        serde_json::json!({"content": content})
    }

    #[test]
    fn parse_accepts_minimal_camel_case() {
        let p = parse_params(&params_json("hello")).unwrap();
        assert_eq!(p.content, "hello");
        assert_eq!(p.channel_id, None);
        assert_eq!(p.reply_to, None);
        assert!(p.mentions.is_empty());
    }

    #[test]
    fn parse_accepts_full_snake_case() {
        let ch = Uuid::new_v4();
        let reply = "a".repeat(64);
        let mention = PublicKey::parse(&"b".repeat(64)).unwrap().to_hex();
        let p = parse_params(&serde_json::json!({
            "channel_id": ch.to_string(),
            "content": "hi",
            "reply_to": reply,
            "mentions": [mention],
        }))
        .unwrap();
        assert_eq!(p.channel_id, Some(ch));
        assert_eq!(p.reply_to, Some(EventId::from_hex(&reply).unwrap()));
        assert_eq!(p.mentions.len(), 1);
    }

    #[test]
    fn parse_rejects_missing_or_empty_content() {
        for body in [
            serde_json::json!({}),
            serde_json::json!({"content": ""}),
            serde_json::json!({"content": "   "}),
            serde_json::json!({"content": 42}),
        ] {
            let err = parse_params(&body).unwrap_err();
            assert!(
                matches!(err, PublishError::InvalidParams(_)),
                "body {body} must be invalid params, got {err:?}"
            );
            assert_eq!(err.code(), -32602);
        }
    }

    #[test]
    fn parse_rejects_oversized_content() {
        let body = params_json(&"x".repeat(MAX_CONTENT_BYTES + 1));
        assert!(matches!(
            parse_params(&body),
            Err(PublishError::InvalidParams(_))
        ));
        // Exactly at the cap passes.
        let at_cap = params_json(&"x".repeat(MAX_CONTENT_BYTES));
        assert!(parse_params(&at_cap).is_ok());
    }

    #[test]
    fn parse_rejects_bad_channel_reply_and_mention() {
        let ch = Uuid::new_v4();
        for body in [
            serde_json::json!({"content": "x", "channelId": "not-a-uuid"}),
            serde_json::json!({"content": "x", "channel_id": 7}),
            serde_json::json!({"content": "x", "replyTo": "zz"}),
            serde_json::json!({"content": "x", "reply_to": ["a".repeat(64)]}),
            serde_json::json!({"content": "x", "mentions": "abc"}),
            serde_json::json!({"content": "x", "mentions": [123]}),
            serde_json::json!({"content": "x", "mentions": ["not-a-key"]}),
            serde_json::json!({"content": "x", "channelId": ch.to_string(), "mentions": vec!["b".repeat(64); MAX_MENTIONS + 1]}),
        ] {
            assert!(
                matches!(parse_params(&body), Err(PublishError::InvalidParams(_))),
                "body {body} must be invalid params"
            );
        }
    }

    #[tokio::test]
    async fn publish_signs_kind9_with_thread_and_mentions() {
        let (handle, mut published) = test_handle();
        let ch = Uuid::new_v4();
        let reply = EventId::from_hex(&"c".repeat(64)).unwrap();
        let mention = PublicKey::parse(&"d".repeat(64)).unwrap();
        let params = PublishParams {
            channel_id: None,
            content: "ship it".into(),
            reply_to: Some(reply),
            mentions: vec![mention],
        };

        let result = publish(&handle, &params, ch).await.expect("publish ok");
        let event = published.recv().await.expect("event relayed");

        assert_eq!(event.kind, Kind::Custom(9));
        assert_eq!(event.content, "ship it");
        assert_eq!(event.pubkey, handle.keys.public_key());
        event.verify().expect("event signature must verify");
        // Flat reply (root == parent): one `e` tag carrying the reply marker.
        let markers = nip10::parse_thread_markers(&event.tags);
        assert_eq!(
            markers.resolve(),
            Some((reply.to_hex(), reply.to_hex())),
            "reply_to must anchor the flat thread; markers: {markers:?}"
        );
        assert!(
            event.tags.iter().any(
                |t| { t.as_slice().first().map(String::as_str) == Some("p") }
                    && t.as_slice().get(1).map(String::as_str) == Some(mention.to_hex().as_str())
            ),
            "mention p-tag missing; tags: {:?}",
            event.tags
        );
        // Result carries the signed event id and honest acceptance semantics.
        assert_eq!(result["eventId"].as_str().unwrap(), event.id.to_hex());
        assert_eq!(result["channelId"].as_str().unwrap(), ch.to_string());
        assert_eq!(result["accepted"], serde_json::json!(true));
        assert_eq!(result["delivery"].as_str().unwrap(), "relay-write-queue");
    }

    #[tokio::test]
    async fn publish_resolves_absent_channel_to_scope_and_rejects_mismatch() {
        let (handle, mut published) = test_handle();
        let ch = Uuid::new_v4();
        let other = Uuid::new_v4();

        let absent = parse_params(&params_json("in scope")).unwrap();
        publish(&handle, &absent, ch).await.unwrap();
        assert!(published.recv().await.is_some());

        let mismatched = parse_params(&serde_json::json!({
            "channelId": other.to_string(),
            "content": "out of scope",
        }))
        .unwrap();
        let err = publish(&handle, &mismatched, ch).await.unwrap_err();
        assert!(
            matches!(err, PublishError::Rejected(_)),
            "scope mismatch must be Rejected, got {err:?}"
        );
        assert_eq!(err.code(), -32000);
        // Nothing was relayed for the rejected publish.
        tokio::time::timeout(std::time::Duration::from_millis(100), published.recv())
            .await
            .expect_err("rejected publish must not reach the relay");
    }

    #[tokio::test]
    async fn publish_reports_dead_relay_writer_as_transport_error() {
        let (publisher, rx) = RelayEventPublisher::test_pair();
        let handle = PublisherHandle {
            keys: Keys::generate(),
            publisher,
        };
        // Close the fake relay: the first publish wakes the forwarder, which
        // fails to fan out and exits — dropping the command receiver.
        drop(rx);
        let params = parse_params(&params_json("first")).unwrap();
        let _ = publish(&handle, &params, Uuid::new_v4()).await;
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let params = parse_params(&params_json("never delivered")).unwrap();
        let err = publish(&handle, &params, Uuid::new_v4()).await.unwrap_err();
        assert!(
            matches!(err, PublishError::Transport(_)),
            "dead relay must be Transport, got {err:?}"
        );
        assert_eq!(err.code(), -32603);
    }
}
