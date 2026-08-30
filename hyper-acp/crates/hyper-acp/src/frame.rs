//! Raw ACP JSON-RPC frame inspection.

use anyhow::{Context, Result, bail};
use serde_json::{Map, Value};

/// A raw ACP frame and metadata parsed from it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawAcpFrame<'a> {
    text: &'a str,
    metadata: FrameMetadata,
}

impl<'a> RawAcpFrame<'a> {
    /// Parse envelope metadata from a raw ACP JSON-RPC text frame.
    ///
    /// The returned frame retains the original text. Parsing is used only to
    /// verify that the frame is JSON-RPC 2.0 and to expose observational
    /// metadata for plugins and tracing.
    ///
    /// # Errors
    ///
    /// Returns an error when the text is not a JSON-RPC 2.0 object or non-empty
    /// batch.
    pub fn parse(text: &'a str) -> Result<Self> {
        let value = serde_json::from_str::<Value>(text).context("ACP frame is not valid JSON")?;
        let top_level = if value.is_array() {
            FrameTopLevel::Batch
        } else {
            FrameTopLevel::Single
        };
        let envelopes = match &value {
            Value::Object(object) => vec![parse_envelope(object)?],
            Value::Array(values) => {
                if values.is_empty() {
                    bail!("JSON-RPC batch frames must not be empty");
                }
                values
                    .iter()
                    .map(|value| match value {
                        Value::Object(object) => parse_envelope(object),
                        _ => bail!("JSON-RPC batch entries must be objects"),
                    })
                    .collect::<Result<Vec<_>>>()?
            }
            _ => bail!("ACP frame must be a JSON-RPC object or batch"),
        };
        Ok(Self {
            text,
            metadata: FrameMetadata {
                top_level,
                byte_len: text.len(),
                envelopes,
            },
        })
    }

    /// Return the original, unmodified frame text.
    #[must_use]
    pub fn text(&self) -> &'a str {
        self.text
    }

    /// Return parsed envelope metadata.
    #[must_use]
    pub fn metadata(&self) -> &FrameMetadata {
        &self.metadata
    }

    /// Consume the frame and return parsed envelope metadata.
    #[must_use]
    pub fn into_metadata(self) -> FrameMetadata {
        self.metadata
    }
}

/// Top-level JSON-RPC frame shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameTopLevel {
    /// A single JSON-RPC request, response, or notification object.
    Single,
    /// A non-empty JSON-RPC batch array.
    Batch,
}

/// Parsed metadata for a raw ACP JSON-RPC frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrameMetadata {
    /// Whether the frame was a single envelope or batch.
    pub top_level: FrameTopLevel,
    /// UTF-8 byte length of the raw text frame.
    pub byte_len: usize,
    /// One entry for a single frame, or one entry per batch element.
    pub envelopes: Vec<EnvelopeMetadata>,
}

impl FrameMetadata {
    /// Return all method names present in request and notification envelopes.
    #[must_use]
    pub fn methods(&self) -> Vec<&str> {
        self.envelopes
            .iter()
            .filter_map(|envelope| envelope.method.as_deref())
            .collect()
    }

    /// Return all session IDs found anywhere in the frame.
    #[must_use]
    pub fn session_ids(&self) -> Vec<&str> {
        self.envelopes
            .iter()
            .flat_map(|envelope| envelope.session_ids.iter().map(String::as_str))
            .collect()
    }
}

/// JSON-RPC envelope kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnvelopeKind {
    /// JSON-RPC request object with `method` and `id`.
    Request,
    /// JSON-RPC notification object with `method` and no `id`.
    Notification,
    /// JSON-RPC response object with `id` and `result` or `error`.
    Response,
}

/// Metadata extracted from one JSON-RPC envelope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvelopeMetadata {
    /// JSON-RPC envelope kind.
    pub kind: EnvelopeKind,
    /// Method name for requests and notifications.
    pub method: Option<String>,
    /// JSON-RPC request ID rendered as compact JSON.
    pub request_id: Option<String>,
    /// Any `sessionId` string values found recursively in this envelope.
    pub session_ids: Vec<String>,
}

fn parse_envelope(object: &Map<String, Value>) -> Result<EnvelopeMetadata> {
    match object.get("jsonrpc").and_then(Value::as_str) {
        Some("2.0") => {}
        _ => bail!("ACP frames must be JSON-RPC 2.0 envelopes"),
    }

    let method = object
        .get("method")
        .map(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .context("JSON-RPC method must be a string")
        })
        .transpose()?;
    let has_id = object.contains_key("id");
    let has_result = object.contains_key("result");
    let has_error = object.contains_key("error");
    let kind = if method.is_some() {
        if has_id {
            EnvelopeKind::Request
        } else {
            EnvelopeKind::Notification
        }
    } else if has_id && (has_result || has_error) {
        EnvelopeKind::Response
    } else {
        bail!("JSON-RPC envelope must be request, response, or notification");
    };
    let request_id = object.get("id").map(Value::to_string);
    let mut session_ids = Vec::new();
    collect_session_ids(&Value::Object(object.clone()), &mut session_ids);
    session_ids.sort();
    session_ids.dedup();

    Ok(EnvelopeMetadata {
        kind,
        method,
        request_id,
        session_ids,
    })
}

fn collect_session_ids(value: &Value, session_ids: &mut Vec<String>) {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if key == "sessionId"
                    && let Some(session_id) = value.as_str()
                {
                    session_ids.push(session_id.to_owned());
                }
                collect_session_ids(value, session_ids);
            }
        }
        Value::Array(values) => {
            for value in values {
                collect_session_ids(value, session_ids);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema;

    #[test]
    fn preserves_raw_request_text_and_extracts_metadata() {
        let text =
            r#"{"jsonrpc":"2.0","id":1,"method":"session/prompt","params":{"sessionId":"s1"}}"#;
        let frame = RawAcpFrame::parse(text).unwrap();

        assert_eq!(frame.text(), text);
        assert_eq!(frame.metadata().top_level, FrameTopLevel::Single);
        assert_eq!(frame.metadata().envelopes[0].kind, EnvelopeKind::Request);
        assert_eq!(frame.metadata().methods(), ["session/prompt"]);
        assert_eq!(frame.metadata().session_ids(), ["s1"]);
    }

    #[test]
    fn accepts_response_notification_and_batch_shapes() {
        let response = RawAcpFrame::parse(r#"{"jsonrpc":"2.0","id":"a","result":{}}"#).unwrap();
        assert_eq!(
            response.metadata().envelopes[0].kind,
            EnvelopeKind::Response
        );

        let notification =
            RawAcpFrame::parse(r#"{"jsonrpc":"2.0","method":"initialized"}"#).unwrap();
        assert_eq!(
            notification.metadata().envelopes[0].kind,
            EnvelopeKind::Notification
        );

        let batch = RawAcpFrame::parse(
            r#"[{"jsonrpc":"2.0","id":1,"method":"initialize"},{"jsonrpc":"2.0","id":1,"result":{}}]"#,
        )
        .unwrap();
        assert_eq!(batch.metadata().top_level, FrameTopLevel::Batch);
        assert_eq!(batch.metadata().envelopes.len(), 2);
    }

    #[test]
    fn rejects_non_json_rpc_frames() {
        assert!(RawAcpFrame::parse(r#"{"method":"initialize"}"#).is_err());
        assert!(RawAcpFrame::parse("[]").is_err());
    }

    #[test]
    fn reexports_canonical_schema_types() {
        let notification = schema::v1::Notification::<serde_json::Value> {
            method: "initialized".into(),
            params: None,
        };
        let message = schema::v1::JsonRpcMessage::wrap(notification);
        let encoded = serde_json::to_string(&message).unwrap();

        let frame = RawAcpFrame::parse(&encoded).unwrap();
        assert_eq!(frame.metadata().methods(), ["initialized"]);
    }
}
