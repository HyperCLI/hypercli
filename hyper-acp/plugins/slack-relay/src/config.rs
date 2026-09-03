//! Configuration for the standalone Slack ACP plugin harness.
//!
//! CLI-first: every option is a CLI flag with env var fallback, following the
//! buzz harness naming pattern (`SLACK_ACP_*` = harness-local knobs).

use clap::Parser;
use thiserror::Error;

/// Default idle timeout (seconds) when `--idle-timeout` /
/// `SLACK_ACP_IDLE_TIMEOUT` is not set.
///
/// Matches the buzz harness default: sized for slow turns where the agent may
/// go silent on its outer ACP channel while running long sub-tools.
pub(crate) const DEFAULT_IDLE_TIMEOUT_SECS: u64 = 1_500;

/// Configuration errors for the Slack plugin harness.
#[derive(Debug, Error)]
pub enum ConfigError {
    /// The agent command resolved to an empty string.
    #[error("agent command must not be empty")]
    EmptyAgentCommand,
}

/// CLI args for `hyper-acp plugin slack`.
#[derive(Debug, Parser)]
#[command(name = "slack-acp", about = "Standalone Slack ACP plugin harness")]
pub struct CliArgs {
    /// Agent binary to spawn (e.g. "opencode").
    #[arg(long, env = "SLACK_ACP_AGENT_COMMAND", default_value = "opencode")]
    pub agent_command: String,

    /// Arguments passed to the agent binary.
    #[arg(
        long,
        env = "SLACK_ACP_AGENT_ARGS",
        default_value = "acp",
        value_delimiter = ' '
    )]
    pub agent_args: Vec<String>,

    /// Number of parallel agent subprocesses. The skeleton spawns slot 0 only;
    /// the range is validated now so later phases can trust the value.
    #[arg(long, env = "SLACK_ACP_AGENTS", default_value_t = 1,
          value_parser = clap::value_parser!(u32).range(1..=32))]
    pub agents: u32,

    /// Idle timeout: max seconds of silence before killing a turn.
    #[arg(long, env = "SLACK_ACP_IDLE_TIMEOUT", default_value_t = DEFAULT_IDLE_TIMEOUT_SECS)]
    pub idle_timeout: u64,
}

/// Validated, owned harness configuration.
#[derive(Debug, Clone)]
pub struct Config {
    /// Agent binary to spawn.
    pub agent_command: String,
    /// Arguments passed to the agent binary.
    pub agent_args: Vec<String>,
    /// Number of parallel agent subprocesses (1..=32).
    pub agents: u32,
    /// Idle timeout in seconds (clamped to a 1s minimum).
    pub idle_timeout_secs: u64,
}

impl Config {
    /// Build a `Config` from already-parsed `CliArgs`. Separated from clap
    /// parsing so tests can construct `CliArgs` via `CliArgs::try_parse_from`
    /// and exercise the full validation path without going through process
    /// args.
    ///
    /// # Errors
    ///
    /// Returns [`ConfigError::EmptyAgentCommand`] when the agent command is
    /// blank after trimming.
    pub fn from_args(args: CliArgs) -> Result<Self, ConfigError> {
        let agent_command = args.agent_command.trim().to_owned();
        if agent_command.is_empty() {
            return Err(ConfigError::EmptyAgentCommand);
        }

        let idle_timeout_secs = if args.idle_timeout == 0 {
            tracing::warn!("idle timeout of 0 is invalid — using 1s minimum");
            1
        } else {
            args.idle_timeout
        };

        Ok(Self {
            agent_command,
            agent_args: args.agent_args,
            agents: args.agents,
            idle_timeout_secs,
        })
    }

    /// Human-readable summary (no secrets).
    #[must_use]
    pub fn summary(&self) -> String {
        format!(
            "agent_cmd={} {} agents={} idle_timeout={}s",
            self.agent_command,
            self.agent_args.join(" "),
            self.agents,
            self.idle_timeout_secs,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ENV_VARS: [&str; 4] = [
        "SLACK_ACP_AGENT_COMMAND",
        "SLACK_ACP_AGENT_ARGS",
        "SLACK_ACP_AGENTS",
        "SLACK_ACP_IDLE_TIMEOUT",
    ];

    fn clear_env() {
        for name in ENV_VARS {
            std::env::remove_var(name);
        }
    }

    #[test]
    fn defaults_parse_and_validate() {
        let _guard = crate::test_env_lock();
        clear_env();
        let args = CliArgs::try_parse_from(["slack-acp"]).expect("defaults parse");
        let config = Config::from_args(args).expect("defaults validate");
        assert_eq!(config.agent_command, "opencode");
        assert_eq!(config.agent_args, vec!["acp".to_owned()]);
        assert_eq!(config.agents, 1);
        assert_eq!(config.idle_timeout_secs, DEFAULT_IDLE_TIMEOUT_SECS);
    }

    #[test]
    fn env_backed_parsing() {
        let _guard = crate::test_env_lock();
        clear_env();
        std::env::set_var("SLACK_ACP_AGENT_COMMAND", "claude-agent-acp");
        std::env::set_var("SLACK_ACP_AGENT_ARGS", "acp --verbose");
        std::env::set_var("SLACK_ACP_AGENTS", "4");
        std::env::set_var("SLACK_ACP_IDLE_TIMEOUT", "60");
        let args = CliArgs::try_parse_from(["slack-acp"]).expect("env parse");
        let config = Config::from_args(args).expect("env validate");
        clear_env();
        assert_eq!(config.agent_command, "claude-agent-acp");
        assert_eq!(
            config.agent_args,
            vec!["acp".to_owned(), "--verbose".to_owned()]
        );
        assert_eq!(config.agents, 4);
        assert_eq!(config.idle_timeout_secs, 60);
    }

    #[test]
    fn agents_range_is_enforced() {
        let _guard = crate::test_env_lock();
        clear_env();
        std::env::set_var("SLACK_ACP_AGENTS", "0");
        assert!(CliArgs::try_parse_from(["slack-acp"]).is_err());
        std::env::set_var("SLACK_ACP_AGENTS", "33");
        assert!(CliArgs::try_parse_from(["slack-acp"]).is_err());
        std::env::set_var("SLACK_ACP_AGENTS", "32");
        assert!(CliArgs::try_parse_from(["slack-acp"]).is_ok());
        clear_env();
    }

    #[test]
    fn empty_agent_command_is_rejected() {
        let args = CliArgs {
            agent_command: "   ".to_owned(),
            agent_args: Vec::new(),
            agents: 1,
            idle_timeout: DEFAULT_IDLE_TIMEOUT_SECS,
        };
        assert!(matches!(
            Config::from_args(args),
            Err(ConfigError::EmptyAgentCommand)
        ));
    }

    #[test]
    fn zero_idle_timeout_clamps_to_one_second() {
        let args = CliArgs {
            agent_command: "opencode".to_owned(),
            agent_args: vec!["acp".to_owned()],
            agents: 1,
            idle_timeout: 0,
        };
        let config = Config::from_args(args).expect("validate");
        assert_eq!(config.idle_timeout_secs, 1);
    }
}
