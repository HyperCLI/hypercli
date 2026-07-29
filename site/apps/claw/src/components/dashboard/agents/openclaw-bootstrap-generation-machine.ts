import type { OpenClawBootstrapFileName } from "@/lib/openclaw-bootstrap-pack";

export type OpenClawBootstrapGenerationStatus =
  | "idle"
  | "queued"
  | "generating"
  | "ready"
  | "fallback";

export interface OpenClawBootstrapGenerationFileState {
  status: OpenClawBootstrapGenerationStatus;
  error?: string;
}

export interface OpenClawBootstrapGenerationState {
  runId: number;
  files: Partial<Record<OpenClawBootstrapFileName, OpenClawBootstrapGenerationFileState>>;
}

export type OpenClawBootstrapGenerationEvent =
  | { type: "QUEUE"; runId: number; names: OpenClawBootstrapFileName[] }
  | { type: "START"; runId: number; name: OpenClawBootstrapFileName }
  | { type: "SUCCEED"; runId: number; name: OpenClawBootstrapFileName }
  | { type: "FALL_BACK"; runId: number; name: OpenClawBootstrapFileName; error?: string }
  | { type: "RESET_TO_FALLBACK"; runId: number; names: OpenClawBootstrapFileName[] };

export function createOpenClawBootstrapGenerationState(): OpenClawBootstrapGenerationState {
  return { runId: 0, files: {} };
}

export function openClawBootstrapGenerationReducer(
  state: OpenClawBootstrapGenerationState,
  event: OpenClawBootstrapGenerationEvent,
): OpenClawBootstrapGenerationState {
  if (event.type !== "QUEUE" && event.type !== "RESET_TO_FALLBACK" && event.runId !== state.runId) {
    return state;
  }

  switch (event.type) {
    case "QUEUE":
      return {
        runId: event.runId,
        files: Object.fromEntries(event.names.map((name) => [name, { status: "queued" }])),
      };
    case "START":
      return {
        ...state,
        files: { ...state.files, [event.name]: { status: "generating" } },
      };
    case "SUCCEED":
      return {
        ...state,
        files: { ...state.files, [event.name]: { status: "ready" } },
      };
    case "FALL_BACK":
      return {
        ...state,
        files: {
          ...state.files,
          [event.name]: {
            status: "fallback",
            ...(event.error ? { error: event.error } : {}),
          },
        },
      };
    case "RESET_TO_FALLBACK":
      return {
        runId: event.runId,
        files: Object.fromEntries(event.names.map((name) => [name, { status: "fallback" }])),
      };
    default:
      return state;
  }
}

export function isOpenClawBootstrapGenerationActive(state: OpenClawBootstrapGenerationState): boolean {
  return Object.values(state.files).some(({ status }) => status === "queued" || status === "generating");
}
