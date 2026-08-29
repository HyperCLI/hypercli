use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Actor {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display: Option<String>,
    pub kind: ActorKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<ActorRole>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActorKind {
    Human,
    Automation,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActorRole {
    Owner,
    Member,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Message {
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TurnContext {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub history: Vec<Value>,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub metadata: Map<String, Value>,
}

impl Default for TurnContext {
    fn default() -> Self {
        Self {
            source: None,
            history: Vec::new(),
            metadata: Map::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ReplyTarget {
    WebThread {
        thread_id: String,
    },
    SlackThread {
        team_id: String,
        channel_id: String,
        thread_ts: String,
    },
    SlackDm {
        team_id: String,
        user_id: String,
    },
    BuzzChannel {
        channel_id: String,
    },
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NormalizedTurn {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    pub idempotency_key: String,
    pub connector: String,
    pub conversation_key: String,
    pub sender: Actor,
    pub message: Message,
    pub reply_target: ReplyTarget,
    #[serde(default)]
    pub context: TurnContext,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub require_reply: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NormalizedCommand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    pub command: PlatformCommand,
    pub connector: String,
    pub conversation_key: String,
    pub actor: Actor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_event_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlatformCommand {
    #[serde(rename = "turn.cancel")]
    TurnCancel,
    #[serde(rename = "turn.steer")]
    TurnSteer,
    #[serde(rename = "session.rotate")]
    SessionRotate,
    #[serde(rename = "runtime.shutdown")]
    RuntimeShutdown,
    #[serde(rename = "runtime.restart_agent")]
    RuntimeRestartAgent,
    #[serde(rename = "runtime.switch_model")]
    RuntimeSwitchModel,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TurnAccepted {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    pub turn_id: String,
    pub conversation_key: String,
    pub status: TurnAdmissionStatus,
    pub queued_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TurnAdmissionStatus {
    Accepted,
    Duplicate,
    Queued,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ControlResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    pub command: PlatformCommand,
    pub status: ControlStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ControlStatus {
    Sent,
    Accepted,
    NotFound,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActivityFrame {
    pub seq: u64,
    pub timestamp: DateTime<Utc>,
    pub kind: ActivityKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connector: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActivityKind {
    #[serde(rename = "runtime.started")]
    RuntimeStarted,
    #[serde(rename = "runtime.ready")]
    RuntimeReady,
    #[serde(rename = "runtime.stopping")]
    RuntimeStopping,
    #[serde(rename = "runtime.stopped")]
    RuntimeStopped,
    #[serde(rename = "runtime.error")]
    RuntimeError,
    #[serde(rename = "agent.spawned")]
    AgentSpawned,
    #[serde(rename = "agent.exited")]
    AgentExited,
    #[serde(rename = "agent.restarted")]
    AgentRestarted,
    #[serde(rename = "session.created")]
    SessionCreated,
    #[serde(rename = "session.rotated")]
    SessionRotated,
    #[serde(rename = "turn.queued")]
    TurnQueued,
    #[serde(rename = "turn.started")]
    TurnStarted,
    #[serde(rename = "turn.liveness")]
    TurnLiveness,
    #[serde(rename = "turn.steer_attempted")]
    TurnSteerAttempted,
    #[serde(rename = "turn.cancelled")]
    TurnCancelled,
    #[serde(rename = "turn.reply_attempted")]
    TurnReplyAttempted,
    #[serde(rename = "turn.reply_delivered")]
    TurnReplyDelivered,
    #[serde(rename = "turn.reply_failed")]
    TurnReplyFailed,
    #[serde(rename = "turn.completed")]
    TurnCompleted,
    #[serde(rename = "turn.failed")]
    TurnFailed,
    #[serde(rename = "acp.read")]
    AcpRead,
    #[serde(rename = "acp.write")]
    AcpWrite,
    #[serde(rename = "mcp.tool_call")]
    McpToolCall,
    #[serde(rename = "mcp.tool_result")]
    McpToolResult,
    #[serde(rename = "connector.event")]
    ConnectorEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TurnTiming {
    pub queued_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub queue_duration_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_liveness_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReplyStatus {
    NotRequired,
    NotAttempted,
    Attempted,
    Delivered,
    Failed,
    NoReply,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    EndTurn,
    Cancelled,
    MaxTokens,
    Timeout,
    NoReply,
    RuntimeError,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorClass {
    Runtime,
    Connector,
    Platform,
    Timeout,
    Cancelled,
    Permission,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TurnUsage {
    pub source: String,
    pub delta_reliable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn: Option<TokenUsage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cumulative: Option<TokenUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TokenUsage {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_read_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_write_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TurnTerminal {
    pub turn_id: String,
    pub conversation_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connector: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(flatten)]
    pub timing: TurnTiming,
    pub reply_status: ReplyStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<StopReason>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_class: Option<ErrorClass>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<TurnError>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<TurnUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TurnError {
    pub code: String,
    pub class: ErrorClass,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TraceSession {
    pub conversation_key: String,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connector: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TraceTurn {
    pub turn_id: String,
    pub conversation_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connector: Option<String>,
    pub idempotency_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    pub status: String,
    pub queued_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<DateTime<Utc>>,
    pub turn: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionListRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionTraceFilter {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionTrace {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub sessions: Vec<TraceSession>,
    pub turns: Vec<TraceTurn>,
    pub activity: Vec<ActivityFrame>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConnectorReply {
    pub connector: String,
    pub turn_id: String,
    pub conversation_key: String,
    pub target: ReplyTarget,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeliveryReceipt {
    pub connector: String,
    pub provider: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    pub target: ReplyTarget,
    pub delivered_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    #[serde(rename = "hello")]
    Hello {
        protocol_version: u32,
        client: ClientInfo,
    },
    #[serde(rename = "turn.submit")]
    TurnSubmit(Box<NormalizedTurn>),
    #[serde(rename = "turn.cancel")]
    TurnCancel {
        request_id: Option<String>,
        conversation_key: String,
        turn_id: Option<String>,
    },
    #[serde(rename = "turn.steer")]
    TurnSteer {
        request_id: Option<String>,
        conversation_key: String,
        message: Message,
    },
    #[serde(rename = "session.rotate")]
    SessionRotate {
        request_id: Option<String>,
        conversation_key: String,
    },
    #[serde(rename = "session.list")]
    SessionList(SessionListRequest),
    #[serde(rename = "session.trace")]
    SessionTrace(SessionTraceFilter),
    #[serde(rename = "runtime.shutdown")]
    RuntimeShutdown { request_id: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClientInfo {
    pub kind: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    #[serde(rename = "hello.ok")]
    HelloOk {
        protocol_version: u32,
        server: ServerInfo,
    },
    #[serde(rename = "activity.replay_end")]
    ActivityReplayEnd { next_seq: u64 },
    #[serde(rename = "turn.accepted")]
    TurnAccepted(TurnAccepted),
    #[serde(rename = "turn.started")]
    TurnStarted {
        turn_id: String,
        conversation_key: String,
        session_id: Option<String>,
        queued_at: DateTime<Utc>,
        started_at: DateTime<Utc>,
    },
    #[serde(rename = "turn.activity")]
    TurnActivity(ActivityFrame),
    #[serde(rename = "turn.reply")]
    TurnReply(ConnectorReply),
    #[serde(rename = "turn.completed")]
    TurnCompleted(TurnTerminal),
    #[serde(rename = "turn.failed")]
    TurnFailed(TurnTerminal),
    #[serde(rename = "control.result")]
    ControlResult(ControlResult),
    #[serde(rename = "session.list")]
    SessionList {
        request_id: Option<String>,
        sessions: Vec<TraceSession>,
    },
    #[serde(rename = "session.trace")]
    SessionTrace(SessionTrace),
    #[serde(rename = "error")]
    Error {
        request_id: Option<String>,
        error: ProtocolErrorBody,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerInfo {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProtocolErrorBody {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}
