export interface ObserverEvent {
  seq: number;
  timestamp: string;
  kind: string;
  agentIndex: number | null;
  channelId: string | null;
  sessionId: string | null;
  turnId: string | null;
  startedAt?: string;
  payload: unknown;
}

export type ActivityRenderClass =
  | "message"
  | "relay-op"
  | "file-edit"
  | "file-read"
  | "skill-read"
  | "image"
  | "shell"
  | "status"
  | "thought"
  | "plan"
  | "permission"
  | "error"
  | "generic"
  | "raw-rail"
  | "suppressed";

export type ToolStatus = "pending" | "executing" | "completed" | "failed";

export interface BuzzActivityEvent {
  id: string;
  renderClass: ActivityRenderClass;
  label: string;
  detail?: string;
  preview?: string;
  status?: ToolStatus;
  isError?: boolean;
  toolCallId?: string;
  messageId?: string;
  turnId?: string | null;
  timestamp: string;
  seq: number;
  raw: ObserverEvent;
}
