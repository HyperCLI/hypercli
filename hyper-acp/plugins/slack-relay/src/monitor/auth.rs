//! OpenClaw `monitor/auth.ts` boundary for Slack auth.
//!
//! Provenance:
//! - `openclaw-git/extensions/slack/src/security.ts` for Slack scoped auth
//!   ownership.
//! - `openclaw-git/extensions/slack/src/config-schema.ts` lines 179-200 for
//!   HTTP-mode `signingSecret` readiness.
//! - Slack's Events API signing contract is the HTTP/Bolt equivalent of the
//!   OpenClaw HTTP mode surface. Rust deviation: this crate exposes the pure
//!   verifier directly instead of depending on Bolt middleware.

use hmac::{Hmac, Mac};
use sha2::Sha256;
use thiserror::Error;

pub use crate::dm::SlackDirectMessageAuthorization;
pub use crate::monitor::dm_auth::{authorize_active_direct_message, maybe_send_pairing_challenge};

const SLACK_SIGNING_VERSION: &str = "v0";
const DEFAULT_SLACK_SIGNATURE_TOLERANCE_SECONDS: i64 = 60 * 5;

/// Slack signing-secret verification errors.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum SlackSigningError {
    /// Missing timestamp header.
    #[error("missing Slack request timestamp")]
    MissingTimestamp,
    /// Invalid timestamp header.
    #[error("invalid Slack request timestamp")]
    InvalidTimestamp,
    /// Missing signature header.
    #[error("missing Slack request signature")]
    MissingSignature,
    /// Unsupported signature version.
    #[error("unsupported Slack request signature version")]
    UnsupportedVersion,
    /// Request timestamp is outside the replay window.
    #[error("stale Slack request timestamp")]
    StaleTimestamp,
    /// Signature mismatch.
    #[error("invalid Slack request signature")]
    SignatureMismatch,
}

/// Verifies an `X-Slack-Signature` value using Slack's `v0:{ts}:{body}` HMAC.
///
/// # Errors
///
/// Returns [`SlackSigningError`] when headers are missing, stale, malformed, or
/// fail constant-time HMAC verification.
pub fn verify_slack_signing_secret(
    signing_secret: &str,
    timestamp_header: Option<&str>,
    signature_header: Option<&str>,
    body: &[u8],
    now_epoch_seconds: i64,
) -> Result<(), SlackSigningError> {
    let timestamp_raw = timestamp_header
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(SlackSigningError::MissingTimestamp)?;
    let timestamp = timestamp_raw
        .parse::<i64>()
        .map_err(|_| SlackSigningError::InvalidTimestamp)?;
    if now_epoch_seconds.saturating_sub(timestamp).abs() > DEFAULT_SLACK_SIGNATURE_TOLERANCE_SECONDS
    {
        return Err(SlackSigningError::StaleTimestamp);
    }
    let signature = signature_header
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(SlackSigningError::MissingSignature)?;
    let Some(hex_signature) = signature.strip_prefix("v0=") else {
        return Err(SlackSigningError::UnsupportedVersion);
    };
    let expected = decode_lower_hex(hex_signature).ok_or(SlackSigningError::SignatureMismatch)?;
    let mut mac = Hmac::<Sha256>::new_from_slice(signing_secret.as_bytes())
        .expect("HMAC accepts any signing-secret length");
    mac.update(SLACK_SIGNING_VERSION.as_bytes());
    mac.update(b":");
    mac.update(timestamp_raw.as_bytes());
    mac.update(b":");
    mac.update(body);
    mac.verify_slice(&expected)
        .map_err(|_| SlackSigningError::SignatureMismatch)
}

fn decode_lower_hex(value: &str) -> Option<Vec<u8>> {
    if !value.len().is_multiple_of(2) {
        return None;
    }
    let mut out = Vec::with_capacity(value.len() / 2);
    for pair in value.as_bytes().chunks_exact(2) {
        let high = hex_nibble(pair[0])?;
        let low = hex_nibble(pair[1])?;
        out.push((high << 4) | low);
    }
    Some(out)
}

fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifies_slack_v0_signatures() {
        let body = b"token=xyzz&team_id=T1&team_domain=test";
        let ts = "1531420618";
        let signature = "v0=cfa5dbd5d5934806273544ee6db30d1e5804a1e174f38f8b5f3a58faf19e9172";
        assert_eq!(
            verify_slack_signing_secret(
                "8f742231b10e8888abcd99yyyzzz85a5",
                Some(ts),
                Some(signature),
                body,
                1_531_420_618
            ),
            Ok(())
        );
    }

    #[test]
    fn rejects_stale_or_bad_signatures() {
        assert!(matches!(
            verify_slack_signing_secret("secret", Some("1"), Some("v0=00"), b"{}", 1_000),
            Err(SlackSigningError::StaleTimestamp)
        ));
        assert!(matches!(
            verify_slack_signing_secret("secret", Some("10"), Some("v0=00"), b"{}", 10),
            Err(SlackSigningError::SignatureMismatch)
        ));
    }
}
