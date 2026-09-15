//! OpenClaw `monitor/allow-list.ts` equivalent.
//!
//! Owns the monitor-shaped allow-list API while delegating the portable matcher
//! implementation to the crate-level Slack allowlist module.

pub use crate::allowlist::{
    normalize_slack_allow_owner_entry, normalize_slack_slug, resolve_slack_allow_list_match,
    resolve_slack_user_allowed, SlackAllowListMatch, SlackAllowListMatchSource,
};

/// OpenClaw-style allow-list match key used by monitor callers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackAllowListMatchKey {
    /// Raw Slack id candidate.
    pub id: Option<String>,
    /// Human name candidate.
    pub name: Option<String>,
    /// OpenClaw slug candidate.
    pub slug: Option<String>,
}

/// Builds the match-key set OpenClaw checks for a Slack sender.
#[must_use]
pub fn build_slack_allow_list_match_key(
    id: Option<&str>,
    name: Option<&str>,
) -> SlackAllowListMatchKey {
    let id = id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase);
    let name = name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase);
    let slug = name.as_deref().map(normalize_slack_slug);
    SlackAllowListMatchKey { id, name, slug }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn match_key_preserves_id_name_and_openclaw_slug() {
        let key = build_slack_allow_list_match_key(Some(" U123 "), Some("Ada Lovelace!"));
        assert_eq!(key.id.as_deref(), Some("u123"));
        assert_eq!(key.name.as_deref(), Some("ada lovelace!"));
        assert_eq!(key.slug.as_deref(), Some("ada-lovelace"));
        assert!(
            resolve_slack_allow_list_match(
                &["ada-lovelace".to_owned()],
                key.id.as_deref(),
                key.name.as_deref(),
                true,
            )
            .allowed
        );
    }
}
