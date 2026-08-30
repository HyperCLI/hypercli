//! Slack allowlist matching.
//!
//! Provenance: `openclaw-git/extensions/slack/src/monitor/allow-list.ts`
//! `normalizeSlackAllowOwnerEntry` lines 42-49,
//! `resolveSlackAllowListMatch` lines 56-82, and `resolveSlackUserAllowed`
//! lines 93-109.

use regex::Regex;

/// Slack allowlist match source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlackAllowListMatchSource {
    /// `*` wildcard.
    Wildcard,
    /// Raw Slack user id.
    Id,
    /// `slack:<id>`.
    PrefixedId,
    /// `user:<id>`.
    PrefixedUser,
    /// Raw user name.
    Name,
    /// `slack:<name>`.
    PrefixedName,
    /// Hyphen slug of user name.
    Slug,
}

/// Slack allowlist match result.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SlackAllowListMatch {
    /// Whether the allowlist matched.
    pub allowed: bool,
    /// Match source.
    pub match_source: Option<SlackAllowListMatchSource>,
}

/// Normalizes an owner allowlist entry to a raw Slack user id.
#[must_use]
pub fn normalize_slack_allow_owner_entry(entry: &str) -> Option<String> {
    let trimmed = normalize_optional_lowercase(entry)?;
    if trimmed == "*" {
        return None;
    }
    let without_prefix = trimmed
        .strip_prefix("slack:")
        .or_else(|| trimmed.strip_prefix("user:"))
        .unwrap_or(&trimmed);
    let re = Regex::new(r"^u[a-z0-9]+$").expect("valid owner regex");
    re.is_match(without_prefix)
        .then(|| without_prefix.to_owned())
}

/// Resolves a Slack allowlist match.
#[must_use]
pub fn resolve_slack_allow_list_match(
    allow_list: &[String],
    id: Option<&str>,
    name: Option<&str>,
    allow_name_matching: bool,
) -> SlackAllowListMatch {
    let normalized_allow: Vec<String> = allow_list
        .iter()
        .filter_map(|entry| normalize_optional_lowercase(entry))
        .collect();
    if normalized_allow.iter().any(|entry| entry == "*") {
        return SlackAllowListMatch {
            allowed: true,
            match_source: Some(SlackAllowListMatchSource::Wildcard),
        };
    }
    let id = id.and_then(normalize_optional_lowercase);
    let name = name.and_then(normalize_optional_lowercase);
    let slug = name.as_deref().map(normalize_slack_slug);
    let mut candidates = vec![
        (id.clone(), SlackAllowListMatchSource::Id),
        (
            id.as_ref().map(|value| format!("slack:{value}")),
            SlackAllowListMatchSource::PrefixedId,
        ),
        (
            id.as_ref().map(|value| format!("user:{value}")),
            SlackAllowListMatchSource::PrefixedUser,
        ),
    ];
    if allow_name_matching {
        candidates.extend([
            (name.clone(), SlackAllowListMatchSource::Name),
            (
                name.as_ref().map(|value| format!("slack:{value}")),
                SlackAllowListMatchSource::PrefixedName,
            ),
            (slug, SlackAllowListMatchSource::Slug),
        ]);
    }
    for (candidate, source) in candidates {
        if candidate
            .as_deref()
            .is_some_and(|value| normalized_allow.iter().any(|entry| entry == value))
        {
            return SlackAllowListMatch {
                allowed: true,
                match_source: Some(source),
            };
        }
    }
    SlackAllowListMatch {
        allowed: false,
        match_source: None,
    }
}

/// Resolves user admission for an optional allowlist.
#[must_use]
pub fn resolve_slack_user_allowed(
    allow_list: Option<&[String]>,
    user_id: Option<&str>,
    user_name: Option<&str>,
    allow_name_matching: bool,
) -> bool {
    let allow_list: Vec<String> = allow_list
        .unwrap_or_default()
        .iter()
        .filter_map(|entry| normalize_optional_lowercase(entry))
        .collect();
    if allow_list.is_empty() {
        return true;
    }
    resolve_slack_allow_list_match(&allow_list, user_id, user_name, allow_name_matching).allowed
}

/// Normalizes Slack/user display names to OpenClaw's hyphen slug behavior.
#[must_use]
pub fn normalize_slack_slug(raw: &str) -> String {
    let mut out = String::new();
    let mut previous_dash = false;
    for ch in raw.trim().to_ascii_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            previous_dash = false;
        } else if !previous_dash {
            out.push('-');
            previous_dash = true;
        }
    }
    out.trim_matches('-').to_owned()
}

fn normalize_optional_lowercase(value: &str) -> Option<String> {
    let trimmed = value.trim().to_ascii_lowercase();
    (!trimmed.is_empty()).then_some(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owner_entry_accepts_only_slack_user_ids() {
        assert_eq!(
            normalize_slack_allow_owner_entry(" user:U123ABC "),
            Some("u123abc".to_owned())
        );
        assert_eq!(normalize_slack_allow_owner_entry("*"), None);
        assert_eq!(normalize_slack_allow_owner_entry("channel:C1"), None);
    }

    #[test]
    fn allowlist_matches_id_prefixes_name_and_slug() {
        assert_eq!(
            resolve_slack_allow_list_match(&["user:u1".to_owned()], Some("U1"), None, false)
                .match_source,
            Some(SlackAllowListMatchSource::PrefixedUser)
        );
        assert!(
            resolve_slack_allow_list_match(
                &["ada-lovelace".to_owned()],
                Some("U1"),
                Some("Ada Lovelace"),
                true
            )
            .allowed
        );
        assert!(
            !resolve_slack_allow_list_match(
                &["ada-lovelace".to_owned()],
                Some("U1"),
                Some("Ada Lovelace"),
                false
            )
            .allowed
        );
    }

    #[test]
    fn user_allowed_normalizes_blank_entries_before_empty_check() {
        assert!(resolve_slack_user_allowed(
            Some(&[" ".to_owned(), "\t".to_owned()]),
            Some("U1"),
            None,
            false,
        ));
    }
}
