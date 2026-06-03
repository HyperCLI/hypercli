export type JourneyCompletionEvent =
  | "agent-created"
  | "source-added"
  | "rules-confirmed"
  | "chat-sent"
  | "reviewed-understanding"
  | "integrations-opened"
  | "workflow-drafted";

export type JourneyActionKind =
  | "create-agent"
  | "open-files"
  | "open-settings"
  | "set-chat-prompt"
  | "open-integrations";

export interface JourneyDay {
  id: string;
  day: number;
  title: string;
  mission: string;
  why: string;
  actionLabel: string;
  actionKind: JourneyActionKind;
  prompt?: string;
  promptChips?: string[];
  briefFocus: string[];
  completionEvents: JourneyCompletionEvent[];
  receipt: string;
}

export interface JourneyReceipt {
  dayId: string;
  text: string;
  timestamp: number;
}
