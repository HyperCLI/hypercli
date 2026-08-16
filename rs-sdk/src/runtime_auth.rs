use std::sync::OnceLock;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use regex::Regex;
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::net::TcpStream;
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};
use url::Url;
use uuid::Uuid;

use crate::HyperCliError;

const AUTH_STATUS_EXECUTABLE: &str = "/usr/local/bin/hypercli-runtime-auth";
const AUTH_LOGIN_COMMAND: &str = "/usr/local/bin/hypercli-runtime-auth login";
const MAX_TERMINAL_OUTPUT_BYTES: usize = 64 * 1024;

/// Coding runtimes whose upstream-native credentials can be managed remotely.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum NativeRuntime {
    ClaudeCode,
    Codex,
    KimiCode,
}

impl NativeRuntime {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude-code",
            Self::Codex => "codex",
            Self::KimiCode => "kimi-code",
        }
    }

    const fn requires_device_challenge(self) -> bool {
        matches!(self, Self::Codex | Self::KimiCode)
    }
}

/// Normalized output from the image-owned `hypercli-runtime-auth status` wrapper.
///
/// Every supported image must provide a definitive boolean. Treating an
/// unknown status as a third state made Desktop appear to support wrappers
/// whose login contract was not actually testable.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RuntimeAuthStatus {
    pub runtime: NativeRuntime,
    pub authenticated: bool,
}

impl RuntimeAuthStatus {
    pub(crate) fn parse(stdout: &str) -> Result<Self, RuntimeAuthError> {
        serde_json::from_str(stdout.trim()).map_err(|_| RuntimeAuthError::InvalidStatus)
    }
}

/// Short-lived credential used only to connect to the protected shell proxy.
///
/// This type deliberately does not implement `Debug`, `Clone`, or `Serialize`:
/// its JWT is not an application credential and must never enter logs, traces,
/// Tauri events, or persisted state.
pub struct RuntimeShellToken {
    pub agent_id: String,
    pub expires_at: String,
    pub ws_url: Url,
    pub shell: Option<String>,
    pub dry_run: bool,
    pub(crate) jwt: SecretString,
}

#[derive(Deserialize)]
pub(crate) struct RuntimeShellTokenResponse {
    agent_id: String,
    jwt: String,
    expires_at: String,
    ws_url: String,
    #[serde(default)]
    dry_run: bool,
    #[serde(default)]
    shell: Option<String>,
}

impl RuntimeShellTokenResponse {
    pub(crate) fn into_token(self) -> Result<RuntimeShellToken, RuntimeAuthError> {
        let ws_url = Url::parse(&self.ws_url).map_err(|_| RuntimeAuthError::InvalidShellToken)?;
        if ws_url.query().is_some() || ws_url.fragment().is_some() {
            return Err(RuntimeAuthError::InvalidShellToken);
        }
        Ok(RuntimeShellToken {
            agent_id: self.agent_id,
            expires_at: self.expires_at,
            ws_url,
            shell: self.shell,
            dry_run: self.dry_run,
            jwt: SecretString::from(self.jwt),
        })
    }
}

impl RuntimeShellToken {
    fn websocket_url(&self) -> Result<Url, RuntimeAuthError> {
        if !matches!(self.ws_url.scheme(), "ws" | "wss") {
            return Err(RuntimeAuthError::InvalidShellToken);
        }
        let mut url = self.ws_url.clone();
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("jwt", self.jwt.expose_secret());
            if let Some(shell) = self.shell.as_deref() {
                query.append_pair("shell", shell);
            }
        }
        Ok(url)
    }
}

/// Sanitized, UI-safe state extracted from a native runtime's terminal login.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub struct RuntimeLoginChallenge {
    pub verification_url: Option<String>,
    pub user_code: Option<String>,
    pub instructions: String,
    pub interactive_required: bool,
    pub completed: bool,
    pub exit_code: Option<i32>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RuntimeLoginResult {
    pub exit_code: i32,
}

#[derive(Debug, Error)]
pub enum RuntimeAuthError {
    #[error(transparent)]
    Api(#[from] HyperCliError),
    #[error("runtime authentication status command exited with status {0}")]
    StatusCommandFailed(i32),
    #[error("runtime authentication status was not valid normalized JSON")]
    InvalidStatus,
    #[error("runtime shell token response was invalid")]
    InvalidShellToken,
    #[error("runtime login websocket connection failed")]
    Connection,
    #[error("runtime login websocket stream failed")]
    Stream,
    #[error("runtime login input must be a single authorization code")]
    InvalidInput,
    #[error("runtime login websocket closed before the command completed")]
    Closed,
    #[error("timed out waiting for {0} login instructions")]
    ChallengeTimeout(&'static str),
    #[error("timed out waiting for {0} login")]
    LoginTimeout(&'static str),
    #[error("{0} login exited with status {1}")]
    LoginFailed(&'static str, i32),
}

type RuntimeSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Live native-authentication process running in an agent PTY.
///
/// The session deliberately does not implement `Debug`. Its WebSocket URL was
/// authenticated with a short-lived JWT, and terminal input can contain a
/// one-time authorization code. Only [`RuntimeLoginChallenge`] is suitable for
/// forwarding to a UI.
pub struct RuntimeLoginSession {
    socket: RuntimeSocket,
    parser: RuntimeLoginParser,
}

struct RuntimeLoginParser {
    runtime: NativeRuntime,
    marker: String,
    raw_output: String,
    challenge: RuntimeLoginChallenge,
}

impl RuntimeLoginSession {
    /// Consume a shell token, connect to the PTY, and start the fixed login wrapper.
    pub async fn connect(
        token: RuntimeShellToken,
        runtime: NativeRuntime,
        challenge_timeout: Duration,
    ) -> Result<Self, RuntimeAuthError> {
        let url = token.websocket_url()?;
        let (socket, _) = connect_async(url.as_str())
            .await
            .map_err(|_| RuntimeAuthError::Connection)?;
        let marker = format!("__HYPERCLI_AUTH_EXIT_{}__", Uuid::new_v4().simple());
        let mut session = Self {
            socket,
            parser: RuntimeLoginParser::new(runtime, marker),
        };
        let command = format!(
            "{AUTH_LOGIN_COMMAND}; _hypercli_auth_rc=$?; printf '\\n{}=%s\\n' \"$_hypercli_auth_rc\"; exit \"$_hypercli_auth_rc\"\n",
            session.parser.marker
        );
        session
            .socket
            .send(Message::Text(command.into()))
            .await
            .map_err(|_| RuntimeAuthError::Stream)?;

        tokio::time::timeout(challenge_timeout, session.read_until_ready())
            .await
            .map_err(|_| RuntimeAuthError::ChallengeTimeout(runtime.as_str()))??;
        Ok(session)
    }

    pub fn runtime(&self) -> NativeRuntime {
        self.parser.runtime
    }

    pub fn challenge(&self) -> &RuntimeLoginChallenge {
        &self.parser.challenge
    }

    /// Send terminal input. A trailing newline is added when absent.
    ///
    /// The value is never retained by the session or included in an error.
    pub async fn send_input(&mut self, value: &str) -> Result<(), RuntimeAuthError> {
        if value.is_empty()
            || value.len() > 2048
            || !value.bytes().all(|byte| {
                byte.is_ascii_alphanumeric()
                    || matches!(byte, b'-' | b'_' | b'.' | b'~' | b'+' | b'/' | b'=' | b'#')
            })
        {
            return Err(RuntimeAuthError::InvalidInput);
        }
        let input = format!("{value}\n");
        self.socket
            .send(Message::Text(input.into()))
            .await
            .map_err(|_| RuntimeAuthError::Stream)
    }

    /// Read until the terminal state changes, returning a sanitized snapshot.
    pub async fn refresh(
        &mut self,
        timeout: Duration,
    ) -> Result<RuntimeLoginChallenge, RuntimeAuthError> {
        let prior = self.parser.challenge.clone();
        tokio::time::timeout(timeout, async {
            while self.parser.challenge == prior && !self.parser.challenge.completed {
                self.read_one().await?;
            }
            Ok::<(), RuntimeAuthError>(())
        })
        .await
        .map_err(|_| RuntimeAuthError::ChallengeTimeout(self.parser.runtime.as_str()))??;
        Ok(self.parser.challenge.clone())
    }

    /// Wait for the login command to exit.
    pub async fn wait(
        &mut self,
        timeout: Duration,
    ) -> Result<RuntimeLoginResult, RuntimeAuthError> {
        tokio::time::timeout(timeout, async {
            while !self.parser.challenge.completed {
                self.read_one().await?;
            }
            Ok::<(), RuntimeAuthError>(())
        })
        .await
        .map_err(|_| RuntimeAuthError::LoginTimeout(self.parser.runtime.as_str()))??;
        let exit_code = self
            .parser
            .challenge
            .exit_code
            .ok_or(RuntimeAuthError::Closed)?;
        if exit_code != 0 {
            return Err(RuntimeAuthError::LoginFailed(
                self.parser.runtime.as_str(),
                exit_code,
            ));
        }
        Ok(RuntimeLoginResult { exit_code })
    }

    /// Interrupt and close the remote login process.
    pub async fn cancel(&mut self) {
        let _ = self.socket.send(Message::Text("\u{3}".into())).await;
        let _ = self.socket.close(None).await;
        self.parser.challenge.completed = true;
    }

    async fn read_until_ready(&mut self) -> Result<(), RuntimeAuthError> {
        while !self.is_ready() {
            self.read_one().await?;
        }
        Ok(())
    }

    fn is_ready(&self) -> bool {
        self.parser.is_ready()
    }

    async fn read_one(&mut self) -> Result<(), RuntimeAuthError> {
        loop {
            match self.socket.next().await {
                Some(Ok(Message::Text(value))) => {
                    self.parser.consume(value.as_str());
                    return Ok(());
                }
                Some(Ok(Message::Binary(value))) => {
                    self.parser.consume(&String::from_utf8_lossy(&value));
                    return Ok(());
                }
                Some(Ok(Message::Ping(value))) => {
                    self.socket
                        .send(Message::Pong(value))
                        .await
                        .map_err(|_| RuntimeAuthError::Stream)?;
                }
                Some(Ok(Message::Close(_))) | None => {
                    self.parser.challenge.completed = true;
                    return Err(RuntimeAuthError::Closed);
                }
                Some(Ok(_)) => {}
                Some(Err(_)) => return Err(RuntimeAuthError::Stream),
            }
        }
    }
}

impl RuntimeLoginParser {
    fn new(runtime: NativeRuntime, marker: String) -> Self {
        Self {
            runtime,
            marker,
            raw_output: String::new(),
            challenge: RuntimeLoginChallenge::default(),
        }
    }

    fn is_ready(&self) -> bool {
        if self.challenge.completed || self.challenge.interactive_required {
            return true;
        }
        if self.runtime.requires_device_challenge() {
            self.challenge.verification_url.is_some() && self.challenge.user_code.is_some()
        } else {
            self.challenge.verification_url.is_some() || self.challenge.user_code.is_some()
        }
    }

    fn consume(&mut self, value: &str) {
        self.raw_output.push_str(value);
        truncate_prefix(&mut self.raw_output, MAX_TERMINAL_OUTPUT_BYTES);
        let output = clean_terminal_output(&self.raw_output);

        if let Some(exit_code) = parse_exit_code(&output, &self.marker) {
            self.challenge.exit_code = Some(exit_code);
            self.challenge.completed = true;
        }
        if self.challenge.verification_url.is_none() {
            self.challenge.verification_url =
                parse_auth_url(&self.raw_output).or_else(|| parse_auth_url(&output));
        }
        if self.challenge.user_code.is_none() {
            self.challenge.user_code = parse_auth_code(&output);
        }
        let lowered = output.to_ascii_lowercase();
        self.challenge.interactive_required |= [
            "select",
            "choose",
            "provider",
            "login method",
            "paste code",
            "paste the code",
            "enter the code",
        ]
        .iter()
        .any(|token| lowered.contains(token));
        self.challenge.instructions = output.replace(&self.marker, "").trim().to_owned();
    }
}

pub(crate) fn auth_status_command() -> Vec<String> {
    vec![AUTH_STATUS_EXECUTABLE.to_owned(), "status".to_owned()]
}

fn ansi_escape_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))")
            .expect("ANSI escape regex is valid")
    })
}

fn auth_url_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r#"(https?://[^\s<>\"'\x1b\x07]+)[\s<>\"'\x1b\x07]"#)
            .expect("auth URL regex is valid")
    })
}

fn auth_code_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"(?im)\b(?:(?:user|device|verification|one[- ]time)\s+code|enter\s+(?:the\s+)?code)\b\s*(?:is|:)?\s*(?:\([^\r\n)]*\)\s*)*([A-Z0-9][A-Z0-9-]{2,}[A-Z0-9])(?:[\s.,;:)\]])",
        )
        .expect("auth code regex is valid")
    })
}

fn clean_terminal_output(value: &str) -> String {
    ansi_escape_regex().replace_all(value, "").replace('\r', "")
}

fn parse_auth_url(output: &str) -> Option<String> {
    auth_url_regex()
        .captures(output)
        .and_then(|captures| captures.get(1))
        .map(|value| {
            value
                .as_str()
                .trim_end_matches(['.', ',', ')', ';', ']'])
                .to_owned()
        })
}

fn parse_auth_code(output: &str) -> Option<String> {
    auth_code_regex()
        .captures_iter(output)
        .find_map(|captures| {
            let value = captures.get(1)?.as_str();
            (!value.eq_ignore_ascii_case("authorization")).then(|| value.to_owned())
        })
}

fn parse_exit_code(output: &str, marker: &str) -> Option<i32> {
    let suffix = output.split_once(&format!("{marker}="))?.1;
    suffix
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>()
        .parse()
        .ok()
}

fn truncate_prefix(value: &mut String, max_bytes: usize) {
    if value.len() <= max_bytes {
        return;
    }
    let mut start = value.len() - max_bytes;
    while !value.is_char_boundary(start) {
        start += 1;
    }
    value.drain(..start);
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_async;

    #[test]
    fn status_parses_all_normalized_runtime_shapes() {
        assert_eq!(
            RuntimeAuthStatus::parse(r#"{"runtime":"claude-code","authenticated":true}"#).unwrap(),
            RuntimeAuthStatus {
                runtime: NativeRuntime::ClaudeCode,
                authenticated: true,
            }
        );
        assert!(
            !RuntimeAuthStatus::parse(r#"{"runtime":"kimi-code","authenticated":false}"#)
                .unwrap()
                .authenticated
        );
        assert!(
            RuntimeAuthStatus::parse(r#"{"runtime":"kimi-code","authenticated":null}"#).is_err()
        );
        assert!(RuntimeAuthStatus::parse(r#"{"runtime":"codex"}"#).is_err());
        assert!(RuntimeAuthStatus::parse("not json").is_err());
    }

    #[test]
    fn parser_handles_split_ansi_device_challenge() {
        let mut parser = parser(NativeRuntime::Codex);
        parser.consume("\x1b]0;codex login --device-auth\x07Open https://auth.openai.com/cod");
        parser.consume("ex/device and enter your one-time code:\nABCD-");
        parser.consume("EFGHJ\n");

        assert_eq!(
            parser.challenge.verification_url.as_deref(),
            Some("https://auth.openai.com/codex/device")
        );
        assert_eq!(parser.challenge.user_code.as_deref(), Some("ABCD-EFGHJ"));
        assert!(!parser.challenge.instructions.contains('\x1b'));
        assert!(parser.is_ready());
    }

    #[test]
    fn parser_does_not_treat_authorization_as_a_device_code() {
        let mut parser = parser(NativeRuntime::Codex);
        parser.consume("Complete device code authorization at https://example.com/device\n");
        assert_eq!(parser.challenge.user_code, None);
    }

    #[test]
    fn claude_browser_challenge_can_request_pasted_input() {
        let mut parser = parser(NativeRuntime::ClaudeCode);
        parser.consume(
            "Open https://claude.ai/oauth/authorize?code=true in your browser.\n\
             Paste the code here when authentication completes: ",
        );

        assert_eq!(
            parser.challenge.verification_url.as_deref(),
            Some("https://claude.ai/oauth/authorize?code=true")
        );
        assert!(parser.challenge.interactive_required);
        assert!(parser.is_ready());
    }

    #[test]
    fn claude_osc8_browser_link_survives_terminal_sanitizing() {
        let mut parser = parser(NativeRuntime::ClaudeCode);
        parser.consume(
            "Opening browser to sign in…\nIf the browser didn't open, visit: \x1b]8;;https://claude.com/cai/oauth/authorize?code=true\x07\x1b[94mhttps://claude.com/cai/oauth/authorize?code=true\x1b[39m\x1b]8;;\x07\nPaste code here if prompted > ",
        );

        assert_eq!(
            parser.challenge.verification_url.as_deref(),
            Some("https://claude.com/cai/oauth/authorize?code=true")
        );
        assert!(parser.challenge.interactive_required);
        assert!(parser.is_ready());
    }

    #[test]
    fn kimi_device_prompt_extracts_enter_code_shape() {
        let mut parser = parser(NativeRuntime::KimiCode);
        parser.consume(
            "Opening browser for Kimi device login: https://auth.kimi.com/device\nIf the browser did not open, paste the URL above and enter code: ABCD-EFGH\nCode expires in 1800s.\nWaiting for authorization to complete...\n",
        );

        assert_eq!(
            parser.challenge.verification_url.as_deref(),
            Some("https://auth.kimi.com/device")
        );
        assert_eq!(parser.challenge.user_code.as_deref(), Some("ABCD-EFGH"));
        assert!(!parser.challenge.interactive_required);
        assert!(parser.is_ready());
    }

    #[tokio::test]
    async fn terminal_input_rejects_shell_control_and_multiline_values_before_io() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            let command = socket.next().await.unwrap().unwrap().into_text().unwrap();
            let marker_start = command.find("__HYPERCLI_AUTH_EXIT_").unwrap();
            let marker_end = command[marker_start + 2..].find("__").unwrap() + marker_start + 4;
            let marker = &command[marker_start..marker_end];
            socket
                .send(Message::Text(
                    "Paste the code: https://auth.example/device\nABCD-EFGH\n".into(),
                ))
                .await
                .unwrap();
            let input = socket.next().await.unwrap().unwrap().into_text().unwrap();
            assert_eq!(input, "authorization-code#state-value\n");
            socket
                .send(Message::Text(format!("\n{marker}=0\n").into()))
                .await
                .unwrap();
        });
        let token = RuntimeShellToken {
            agent_id: "agent-1".to_owned(),
            expires_at: "2026-08-05T12:00:00Z".to_owned(),
            ws_url: Url::parse(&format!("ws://{address}/ws/shell/agent-1")).unwrap(),
            shell: Some("/bin/bash".to_owned()),
            dry_run: false,
            jwt: SecretString::from("short-lived-jwt".to_owned()),
        };
        let mut session =
            RuntimeLoginSession::connect(token, NativeRuntime::ClaudeCode, Duration::from_secs(2))
                .await
                .unwrap();
        session
            .send_input("authorization-code#state-value")
            .await
            .unwrap();
        for rejected in ["code\nuname -a", "code;uname", "$(uname)", "code\u{1b}"] {
            assert!(matches!(
                session.send_input(rejected).await,
                Err(RuntimeAuthError::InvalidInput)
            ));
        }
        assert_eq!(
            session.wait(Duration::from_secs(2)).await.unwrap(),
            RuntimeLoginResult { exit_code: 0 }
        );
        server.await.unwrap();
    }

    #[tokio::test]
    async fn session_uses_fixed_wrapper_and_waits_for_exit_marker() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            let command = socket.next().await.unwrap().unwrap().into_text().unwrap();
            assert!(command.starts_with(AUTH_LOGIN_COMMAND));
            let marker_start = command.find("__HYPERCLI_AUTH_EXIT_").unwrap();
            let marker_end = command[marker_start + 2..].find("__").unwrap() + marker_start + 4;
            let marker = &command[marker_start..marker_end];
            socket
                .send(Message::Text(
                    "Open https://auth.example/device and enter device code ABCD-EFGH\n".into(),
                ))
                .await
                .unwrap();
            let input = socket.next().await.unwrap().unwrap().into_text().unwrap();
            assert_eq!(input, "continue\n");
            socket
                .send(Message::Text(format!("\n{marker}=0\n").into()))
                .await
                .unwrap();
        });

        let token = RuntimeShellToken {
            agent_id: "agent-1".to_owned(),
            expires_at: "2026-08-05T12:00:00Z".to_owned(),
            ws_url: Url::parse(&format!("ws://{address}/ws/shell/agent-1")).unwrap(),
            shell: Some("/bin/bash".to_owned()),
            dry_run: false,
            jwt: SecretString::from("short-lived-jwt".to_owned()),
        };
        let mut session =
            RuntimeLoginSession::connect(token, NativeRuntime::Codex, Duration::from_secs(2))
                .await
                .unwrap();
        assert_eq!(
            session.challenge().verification_url.as_deref(),
            Some("https://auth.example/device")
        );
        assert_eq!(session.challenge().user_code.as_deref(), Some("ABCD-EFGH"));
        session.send_input("continue").await.unwrap();
        assert_eq!(
            session.wait(Duration::from_secs(2)).await.unwrap(),
            RuntimeLoginResult { exit_code: 0 }
        );
        server.await.unwrap();
    }

    fn parser(runtime: NativeRuntime) -> RuntimeLoginParser {
        RuntimeLoginParser::new(runtime, "__HYPERCLI_AUTH_EXIT_test__".to_owned())
    }
}
