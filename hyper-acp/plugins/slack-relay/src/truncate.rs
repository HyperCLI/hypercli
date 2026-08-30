//! Slack text truncation ported from OpenClaw `extensions/slack/src/truncate.ts`.

/// Trims and truncates Slack text on a UTF-8 scalar boundary.
#[must_use]
pub fn truncate_slack_text(value: &str, max: usize) -> String {
    let trimmed = value.trim();
    if trimmed.len() <= max {
        return trimmed.to_owned();
    }
    if max == 0 {
        return String::new();
    }
    if max == 1 {
        return trimmed
            .chars()
            .next()
            .map_or_else(String::new, |ch| ch.to_string());
    }
    let mut out = String::new();
    for ch in trimmed.chars() {
        if out.len() + ch.len_utf8() > max.saturating_sub(1) {
            break;
        }
        out.push(ch);
    }
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn truncates_without_splitting_emoji() {
        assert_eq!(super::truncate_slack_text("  a🙂bc  ", 6), "a🙂…");
        assert_eq!(super::truncate_slack_text(" abc ", 10), "abc");
    }
}
