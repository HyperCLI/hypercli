//! Generic HyperCLI ACP prompt injection.

use std::borrow::Cow;
use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use serde_json::Value;

const COMPILED_BASE_PROMPT: &str = include_str!("base_prompt.md");
const MAX_PROMPT_FILE_BYTES: usize = 1_048_576;

#[derive(Debug, Clone)]
/// Generic prompt configuration for ACP sessions.
///
/// Override semantics per env var:
/// - default: the compiled base prompt is wrapped in `<base>`.
/// - `HYPER_ACP_SYSTEM_PROMPT(_FILE)`: full replacement — the configured text
///   IS the prompt (no `<base>` wrapper), replacing the compiled default.
/// - `HYPER_ACP_BASE_PROMPT_FILE`: replaces only the `<base>` body.
/// - `HYPER_ACP_NO_BASE_PROMPT`: disables the base prompt entirely.
///
/// A client-provided `session/new` `systemPrompt` is always appended last as
/// `<session-context>` (clients layer after host layers).
pub struct PromptConfig {
    base_prompt: Option<String>,
    system_prompt: Option<String>,
}

impl PromptConfig {
    /// Resolve generic HyperCLI ACP prompt configuration from `HYPER_ACP_*` env vars.
    ///
    /// # Errors
    ///
    /// Returns an error when a configured prompt file cannot be read or exceeds
    /// the prompt file size limit.
    pub fn from_env() -> Result<Self> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    pub(crate) fn from_lookup(mut lookup: impl FnMut(&str) -> Option<String>) -> Result<Self> {
        let no_base_prompt = truthy(lookup("HYPER_ACP_NO_BASE_PROMPT").as_deref());
        let base_prompt = if no_base_prompt {
            None
        } else if let Some(path) = lookup("HYPER_ACP_BASE_PROMPT_FILE") {
            Some(read_prompt_file(&PathBuf::from(path))?)
        } else {
            Some(COMPILED_BASE_PROMPT.to_owned())
        };

        let system_prompt = match (
            lookup("HYPER_ACP_SYSTEM_PROMPT"),
            lookup("HYPER_ACP_SYSTEM_PROMPT_FILE"),
        ) {
            (Some(_), Some(_)) => bail!(
                "HYPER_ACP_SYSTEM_PROMPT and HYPER_ACP_SYSTEM_PROMPT_FILE are mutually exclusive"
            ),
            (Some(prompt), None) => Some(prompt),
            (None, Some(path)) => Some(read_prompt_file(&PathBuf::from(path))?),
            (None, None) => None,
        };

        Ok(Self {
            base_prompt,
            system_prompt,
        })
    }

    #[must_use]
    /// Return true when any generic prompt layer is configured.
    pub fn has_prompt(&self) -> bool {
        self.base_prompt.is_some() || self.system_prompt.is_some()
    }

    #[must_use]
    /// Return true when `HYPER_ACP_SYSTEM_PROMPT(_FILE)` fully replaces the
    /// compiled default: the configured text IS the prompt (no `<base>`
    /// wrapper) instead of layering over it.
    pub fn is_override(&self) -> bool {
        self.system_prompt.is_some()
    }

    /// Compose the prompt for one session, layering an optional client
    /// `session/new` `systemPrompt` last as `<session-context>`.
    ///
    /// With a `HYPER_ACP_SYSTEM_PROMPT(_FILE)` override the override text is
    /// emitted verbatim (no `<base>` tag); otherwise the base prompt (compiled
    /// default or `HYPER_ACP_BASE_PROMPT_FILE` content) is wrapped in `<base>`.
    #[must_use]
    pub fn compose(&self, incoming_system_prompt: Option<&str>) -> Option<String> {
        compose_prompt(
            self.base_prompt.as_deref(),
            self.system_prompt.as_deref(),
            incoming_system_prompt,
        )
    }

    /// Inject configured prompt sections into every client `session/new` frame.
    ///
    /// Non-`session/new` frames are returned byte-for-byte. Batch frames are
    /// rewritten element-wise when they contain `session/new` requests.
    ///
    /// # Errors
    ///
    /// Returns an error when a rewritten frame cannot be serialized.
    pub fn inject_client_frame<'a>(&self, line: &'a str) -> Result<Cow<'a, str>> {
        if !self.has_prompt() || !line.contains("session/new") {
            return Ok(Cow::Borrowed(line));
        }

        let mut value: Value =
            serde_json::from_str(line).context("parse ACP frame for prompt injection")?;
        let changed = match &mut value {
            Value::Array(items) => {
                let mut changed = false;
                for item in items {
                    changed |= self.inject_session_new(item);
                }
                changed
            }
            item => self.inject_session_new(item),
        };

        if changed {
            Ok(Cow::Owned(serde_json::to_string(&value)?))
        } else {
            Ok(Cow::Borrowed(line))
        }
    }

    fn inject_session_new(&self, frame: &mut Value) -> bool {
        if frame.get("method").and_then(Value::as_str) != Some("session/new") {
            return false;
        }
        let Some(params) = frame.get_mut("params").and_then(Value::as_object_mut) else {
            return false;
        };

        let existing = params
            .get("systemPrompt")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let prompt = self.compose(existing.as_deref());
        if let Some(prompt) = prompt {
            params.insert("systemPrompt".to_owned(), Value::String(prompt));
            true
        } else {
            false
        }
    }
}

fn compose_prompt(
    base_prompt: Option<&str>,
    system_prompt: Option<&str>,
    incoming_system_prompt: Option<&str>,
) -> Option<String> {
    // Full-replacement override: the configured text IS the prompt — no
    // `<base>` wrapper — with client `<session-context>` still appended last.
    if let Some(prompt) = clean_prompt(system_prompt) {
        let mut sections = vec![prompt.to_owned()];
        if let Some(incoming) = clean_prompt(incoming_system_prompt) {
            sections.push(section("session-context", incoming));
        }
        return Some(sections.join("\n\n"));
    }
    let mut sections = Vec::with_capacity(2);
    if let Some(prompt) = clean_prompt(base_prompt) {
        sections.push(section("base", prompt));
    }
    if let Some(prompt) = clean_prompt(incoming_system_prompt) {
        sections.push(section("session-context", prompt));
    }
    (!sections.is_empty()).then(|| sections.join("\n\n"))
}

fn clean_prompt(prompt: Option<&str>) -> Option<&str> {
    prompt.map(str::trim).filter(|prompt| !prompt.is_empty())
}

fn section(name: &str, body: &str) -> String {
    format!("<{name}>\n{body}\n</{name}>")
}

fn read_prompt_file(path: &PathBuf) -> Result<String> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("read prompt file {}", path.display()))?;
    if content.len() > MAX_PROMPT_FILE_BYTES {
        bail!(
            "prompt file {} exceeds 1 MB limit ({} bytes)",
            path.display(),
            content.len()
        );
    }
    Ok(content)
}

fn truthy(value: Option<&str>) -> bool {
    matches!(
        value.map(str::trim).map(str::to_ascii_lowercase).as_deref(),
        Some("1" | "true" | "yes" | "on")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn config(env: &[(&str, &str)]) -> PromptConfig {
        let env: HashMap<&str, &str> = env.iter().copied().collect();
        PromptConfig::from_lookup(|name| env.get(name).map(|value| (*value).to_owned())).unwrap()
    }

    fn rewritten_system_prompt(config: &PromptConfig, line: &str) -> String {
        let line = config.inject_client_frame(line).unwrap();
        let value: Value = serde_json::from_str(&line).unwrap();
        value["params"]["systemPrompt"].as_str().unwrap().to_owned()
    }

    #[test]
    fn default_base_prompt_is_compiled_into_session_new() {
        let prompt = rewritten_system_prompt(
            &config(&[]),
            r#"{"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"/tmp"}}"#,
        );

        assert!(prompt.contains("<base>"));
        assert!(prompt.contains("HyperCLI hosted workspace"));
    }

    #[test]
    fn no_base_prompt_disables_compiled_default() {
        let line = config(&[("HYPER_ACP_NO_BASE_PROMPT", "true")])
            .inject_client_frame(
                r#"{"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"/tmp","systemPrompt":"client context"}}"#,
            )
            .unwrap();
        let value: Value = serde_json::from_str(&line).unwrap();

        // No host prompt configured: the frame is passed through untouched.
        assert_eq!(value["params"]["systemPrompt"], "client context");
    }

    #[test]
    fn system_prompt_env_is_a_verbatim_full_replacement_of_the_compiled_base() {
        let config = config(&[("HYPER_ACP_SYSTEM_PROMPT", "override persona")]);
        assert!(config.is_override());

        let prompt = rewritten_system_prompt(
            &config,
            r#"{"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"/tmp"}}"#,
        );

        assert_eq!(prompt, "override persona");
        assert!(!prompt.contains("<base>"));
        assert!(!prompt.contains("HyperCLI hosted workspace"));
    }

    #[test]
    fn system_prompt_file_is_a_verbatim_full_replacement() {
        let path =
            std::env::temp_dir().join(format!("hyper-acp-system-prompt-{}.md", std::process::id()));
        std::fs::write(&path, "file persona\n").unwrap();

        let prompt = rewritten_system_prompt(
            &config(&[("HYPER_ACP_SYSTEM_PROMPT_FILE", path.to_str().unwrap())]),
            r#"{"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"/tmp"}}"#,
        );

        drop(std::fs::remove_file(path));
        assert_eq!(prompt, "file persona");
        assert!(!prompt.contains("<base>"));
    }

    #[test]
    fn override_still_appends_client_session_context_last() {
        let prompt = rewritten_system_prompt(
            &config(&[("HYPER_ACP_SYSTEM_PROMPT", "env instructions")]),
            r#"{"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"/tmp","systemPrompt":"client context"}}"#,
        );

        assert_eq!(
            prompt,
            "env instructions\n\n<session-context>\nclient context\n</session-context>"
        );
    }

    #[test]
    fn without_override_client_session_context_layers_after_base() {
        let prompt = rewritten_system_prompt(
            &config(&[]),
            r#"{"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"/tmp","systemPrompt":"client context"}}"#,
        );

        let base = prompt.find("<base>").unwrap();
        let context = prompt.find("<session-context>").unwrap();
        assert!(base < context);
        assert!(prompt.contains("HyperCLI hosted workspace"));
        assert!(prompt.contains("client context"));
    }

    #[test]
    fn non_session_new_frames_are_byte_preserved() {
        let line = r#"{"jsonrpc":"2.0","id":1,"method":"session/prompt","params":{}}"#;

        assert!(matches!(
            config(&[]).inject_client_frame(line).unwrap(),
            Cow::Borrowed(returned) if returned == line
        ));
    }

    #[test]
    fn injects_every_session_new_in_batch() {
        let line = r#"[{"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"/tmp/a"}},{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/tmp/b"}}]"#;

        let line = config(&[("HYPER_ACP_SYSTEM_PROMPT", "env instructions")])
            .inject_client_frame(line)
            .unwrap();
        let value: Value = serde_json::from_str(&line).unwrap();
        let items = value.as_array().unwrap();

        assert!(
            items[0]["params"]["systemPrompt"]
                .as_str()
                .unwrap()
                .contains("env instructions")
        );
        assert!(
            items[1]["params"]["systemPrompt"]
                .as_str()
                .unwrap()
                .contains("env instructions")
        );
    }

    #[test]
    fn base_prompt_file_overrides_compiled_default() {
        let path =
            std::env::temp_dir().join(format!("hyper-acp-base-prompt-{}.md", std::process::id()));
        std::fs::write(&path, "file base\n").unwrap();

        let prompt = rewritten_system_prompt(
            &config(&[("HYPER_ACP_BASE_PROMPT_FILE", path.to_str().unwrap())]),
            r#"{"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"/tmp"}}"#,
        );

        drop(std::fs::remove_file(path));
        assert!(prompt.contains("<base>\nfile base\n</base>"));
        assert!(!prompt.contains("HyperCLI hosted workspace"));
    }
}
