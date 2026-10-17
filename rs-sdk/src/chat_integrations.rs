//! Explicit chat connector launch configuration; no ambient credentials or I/O.
use std::collections::BTreeMap;
use url::Url;

/// Validated ENV split into public settings and credentials. Deliberately no Debug.
pub struct ChatIntegrationLaunchConfig {
    pub env: BTreeMap<String, String>,
    pub secrets: BTreeMap<String, String>,
}

/// Validate a complete connector. Provider authentication and host activation are
/// separate; this helper only constructs the existing deployment launch maps.
pub fn build_chat_integration_config(
    integration: &str,
    values: &BTreeMap<String, String>,
) -> Result<ChatIntegrationLaunchConfig, String> {
    let (fields, secrets, default): (&[&str], &[&str], Option<(&str, &str)>) = match integration {
        "slack" => (
            &[
                "SLACK_MODE",
                "SLACK_BOT_TOKEN",
                "SLACK_APP_TOKEN",
                "SLACK_SIGNING_SECRET",
            ],
            &["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_SIGNING_SECRET"],
            Some(("SLACK_MODE", "socket")),
        ),
        "buzz" => (
            &["BUZZ_RELAY_URL", "BUZZ_PRIVATE_KEY", "BUZZ_AUTH_TAG"],
            &["BUZZ_PRIVATE_KEY", "BUZZ_AUTH_TAG"],
            None,
        ),
        "teams" => (
            &[
                "TEAMS_APP_ID",
                "TEAMS_APP_SECRET",
                "TEAMS_TENANT_ID",
                "TEAMS_TRUSTED_SERVICE_BASES",
            ],
            &["TEAMS_APP_SECRET"],
            None,
        ),
        "telegram" => (
            &[
                "TELEGRAM_MODE",
                "TELEGRAM_BOT_TOKEN",
                "TELEGRAM_WEBHOOK_URL",
                "TELEGRAM_WEBHOOK_SECRET",
            ],
            &["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"],
            Some(("TELEGRAM_MODE", "polling")),
        ),
        _ => return Err("Unknown chat integration".into()),
    };
    let mut normalized = BTreeMap::new();
    if let Some((key, value)) = default {
        normalized.insert(key.to_owned(), value.to_owned());
    }
    for (key, value) in values {
        if !fields.contains(&key.as_str()) {
            return Err("Unknown field for chat integration".into());
        }
        if value.contains(['\r', '\n', '\0']) {
            return Err(format!("{key} must be a single-line string"));
        }
        if !value.trim().is_empty() {
            normalized.insert(key.clone(), value.trim().to_owned());
        }
    }
    let require = |keys: &[&str]| -> Result<(), String> {
        for key in keys {
            if !normalized.contains_key(*key) {
                return Err(format!("{key} is required"));
            }
        }
        Ok(())
    };
    let absent = |keys: &[&str]| -> Result<(), String> {
        for key in keys {
            if normalized.contains_key(*key) {
                return Err(format!("{key} does not apply to the selected mode"));
            }
        }
        Ok(())
    };
    match integration {
        "slack" => {
            require(&["SLACK_BOT_TOKEN"])?;
            match normalized["SLACK_MODE"].as_str() {
                "socket" => {
                    require(&["SLACK_APP_TOKEN"])?;
                    absent(&["SLACK_SIGNING_SECRET"])?;
                }
                "http" => {
                    require(&["SLACK_SIGNING_SECRET"])?;
                    absent(&["SLACK_APP_TOKEN"])?;
                }
                _ => return Err("SLACK_MODE must be socket or http".into()),
            }
        }
        "buzz" => {
            require(&["BUZZ_RELAY_URL", "BUZZ_PRIVATE_KEY"])?;
            validate_url(
                "BUZZ_RELAY_URL",
                &normalized["BUZZ_RELAY_URL"],
                &["ws", "wss"],
            )?;
        }
        "teams" => {
            require(fields)?;
            for key in ["TEAMS_APP_ID", "TEAMS_TENANT_ID"] {
                let value = &normalized[key];
                if value.len() != 36
                    || !value.bytes().enumerate().all(|(i, c)| {
                        if [8, 13, 18, 23].contains(&i) {
                            c == b'-'
                        } else {
                            c.is_ascii_hexdigit()
                        }
                    })
                {
                    return Err(format!("{key} must be a UUID"));
                }
            }
            let bases: Vec<String> =
                serde_json::from_str(&normalized["TEAMS_TRUSTED_SERVICE_BASES"]).map_err(|_| {
                    "TEAMS_TRUSTED_SERVICE_BASES must be a nonempty JSON array of URLs"
                })?;
            if bases.is_empty() {
                return Err(
                    "TEAMS_TRUSTED_SERVICE_BASES must be a nonempty JSON array of URLs".into(),
                );
            }
            for base in &bases {
                validate_url("TEAMS_TRUSTED_SERVICE_BASES", base, &["https"])?;
                if !base.ends_with('/') {
                    return Err("TEAMS_TRUSTED_SERVICE_BASES URLs must end with /".into());
                }
            }
            normalized.insert(
                "TEAMS_TRUSTED_SERVICE_BASES".into(),
                serde_json::to_string(&bases).expect("string array"),
            );
        }
        "telegram" => {
            require(&["TELEGRAM_BOT_TOKEN"])?;
            match normalized["TELEGRAM_MODE"].as_str() {
                "webhook" => {
                    require(&["TELEGRAM_WEBHOOK_URL", "TELEGRAM_WEBHOOK_SECRET"])?;
                    validate_url(
                        "TELEGRAM_WEBHOOK_URL",
                        &normalized["TELEGRAM_WEBHOOK_URL"],
                        &["https"],
                    )?;
                    let secret = &normalized["TELEGRAM_WEBHOOK_SECRET"];
                    if secret.len() > 256
                        || !secret
                            .bytes()
                            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
                    {
                        return Err(
                            "TELEGRAM_WEBHOOK_SECRET must contain 1–256 letters, digits, _ or -"
                                .into(),
                        );
                    }
                }
                "polling" => absent(&["TELEGRAM_WEBHOOK_URL", "TELEGRAM_WEBHOOK_SECRET"])?,
                _ => return Err("TELEGRAM_MODE must be polling or webhook".into()),
            }
        }
        _ => unreachable!(),
    }
    let mut result = ChatIntegrationLaunchConfig {
        env: BTreeMap::new(),
        secrets: BTreeMap::new(),
    };
    for (key, value) in normalized {
        if secrets.contains(&key.as_str()) {
            result.secrets.insert(key, value);
        } else {
            result.env.insert(key, value);
        }
    }
    Ok(result)
}

fn validate_url(key: &str, value: &str, schemes: &[&str]) -> Result<Url, String> {
    if !value.contains("://")
        || value.chars().any(|c| {
            c.is_whitespace() || c.is_control() || matches!(c, '\\' | '?' | '#' | '\u{feff}')
        })
    {
        return Err(format!("{key} has an invalid URL"));
    }
    let authority = value
        .split_once("://")
        .map(|(_, rest)| rest.split('/').next().unwrap_or(""))
        .unwrap_or("");
    if !authority.is_ascii() {
        return Err(format!("{key} has an invalid URL"));
    }
    let pattern = regex::Regex::new(r"(?i)^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::([0-9]+))?$").unwrap();
    let parts = pattern
        .captures(authority)
        .ok_or_else(|| format!("{key} has an invalid URL"))?;
    if parts
        .get(2)
        .is_some_and(|port| port.as_str().parse::<u16>().is_err())
    {
        return Err(format!("{key} has an invalid URL"));
    }
    let host = &parts[1];
    if !host.starts_with('[') {
        let labels: Vec<_> = host.strip_suffix('.').unwrap_or(host).split('.').collect();
        let label = regex::Regex::new(r"(?i)^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$").unwrap();
        let numeric = regex::Regex::new(r"(?i)^(?:[0-9]+|0x[0-9a-f]*)$")
            .unwrap()
            .is_match(labels.last().unwrap());
        let octet = regex::Regex::new(r"^(?:0|[1-9][0-9]{0,2})$").unwrap();
        if host.len() > 253
            || labels
                .iter()
                .any(|part| part.to_ascii_lowercase().starts_with("xn--") || !label.is_match(part))
            || (numeric
                && (labels.len() != 4
                    || labels
                        .iter()
                        .any(|part| !octet.is_match(part) || part.parse::<u8>().is_err())))
        {
            return Err(format!("{key} has an invalid URL"));
        }
    }
    let parsed = Url::parse(value).map_err(|_| format!("{key} must be an absolute URL"))?;
    if !schemes.contains(&parsed.scheme())
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(format!("{key} has an invalid URL"));
    }
    Ok(parsed)
}
