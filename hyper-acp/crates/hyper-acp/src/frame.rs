//! Raw ACP JSON-RPC frame validation.

use anyhow::{Context, Result, bail};
use serde_json::{Map, Value};

/// Validate that a raw ACP text frame is a JSON-RPC 2.0 object or non-empty
/// batch.
///
/// Parsing is used only to verify the frame; the text itself is forwarded
/// unchanged by the transports.
///
/// # Errors
///
/// Returns an error when the text is not a JSON-RPC 2.0 object or non-empty
/// batch.
pub(crate) fn validate_frame(text: &str) -> Result<()> {
    let value = serde_json::from_str::<Value>(text).context("ACP frame is not valid JSON")?;
    match &value {
        Value::Object(object) => validate_envelope(object),
        Value::Array(values) => {
            if values.is_empty() {
                bail!("JSON-RPC batch frames must not be empty");
            }
            for value in values {
                match value {
                    Value::Object(object) => validate_envelope(object)?,
                    _ => bail!("JSON-RPC batch entries must be objects"),
                }
            }
            Ok(())
        }
        _ => bail!("ACP frame must be a JSON-RPC object or batch"),
    }
}

fn validate_envelope(object: &Map<String, Value>) -> Result<()> {
    match object.get("jsonrpc").and_then(Value::as_str) {
        Some("2.0") => {}
        _ => bail!("ACP frames must be JSON-RPC 2.0 envelopes"),
    }
    if let Some(method) = object.get("method") {
        if !method.is_string() {
            bail!("JSON-RPC method must be a string");
        }
        return Ok(());
    }
    let has_id = object.contains_key("id");
    let is_response = has_id && (object.contains_key("result") || object.contains_key("error"));
    if !is_response {
        bail!("JSON-RPC envelope must be request, response, or notification");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema;

    #[test]
    fn accepts_request_response_notification_and_batch_shapes() {
        validate_frame(
            r#"{"jsonrpc":"2.0","id":1,"method":"session/prompt","params":{"sessionId":"s1"}}"#,
        )
        .unwrap();
        validate_frame(r#"{"jsonrpc":"2.0","id":"a","result":{}}"#).unwrap();
        validate_frame(r#"{"jsonrpc":"2.0","method":"initialized"}"#).unwrap();
        validate_frame(
            r#"[{"jsonrpc":"2.0","id":1,"method":"initialize"},{"jsonrpc":"2.0","id":1,"result":{}}]"#,
        )
        .unwrap();
    }

    #[test]
    fn rejects_non_json_rpc_frames() {
        assert!(validate_frame(r#"{"method":"initialize"}"#).is_err());
        assert!(validate_frame("[]").is_err());
        assert!(validate_frame("42").is_err());
        assert!(validate_frame("[42]").is_err());
        assert!(validate_frame(r#"{"jsonrpc":"2.0","id":1}"#).is_err());
        assert!(validate_frame(r#"{"jsonrpc":"2.0","method":42}"#).is_err());
        assert!(validate_frame("not json").is_err());
    }

    #[test]
    fn reexports_canonical_schema_types() {
        let notification = schema::v1::Notification::<serde_json::Value> {
            method: "initialized".into(),
            params: None,
        };
        let message = schema::v1::JsonRpcMessage::wrap(notification);
        let encoded = serde_json::to_string(&message).unwrap();

        validate_frame(&encoded).unwrap();
    }
}
