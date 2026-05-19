export interface FirstAgentWizardState {
  stepIndex: number;
  selectedPlanId: string;
  creating: boolean;
  createError: string | null;
}

export type FirstAgentWizardEvent =
  | { type: "GO_TO_STEP"; stepIndex: number; maxStepIndex: number }
  | { type: "PLAN_OPTIONS_CHANGED"; planIds: string[]; fallbackPlanId: string }
  | { type: "SELECT_PLAN"; planId: string }
  | { type: "CREATE_REQUESTED" }
  | { type: "CREATE_FAILED"; message: string }
  | { type: "CREATE_FINISHED_WITHOUT_ID" }
  | { type: "CLEAR_ERROR" };

export function createFirstAgentWizardState(initialPlanId: string): FirstAgentWizardState {
  return {
    stepIndex: 0,
    selectedPlanId: initialPlanId,
    creating: false,
    createError: null,
  };
}

export function firstAgentWizardReducer(
  state: FirstAgentWizardState,
  event: FirstAgentWizardEvent,
): FirstAgentWizardState {
  switch (event.type) {
    case "GO_TO_STEP":
      return {
        ...state,
        stepIndex: Math.max(0, Math.min(event.maxStepIndex, event.stepIndex)),
      };
    case "PLAN_OPTIONS_CHANGED":
      return event.planIds.includes(state.selectedPlanId)
        ? state
        : { ...state, selectedPlanId: event.fallbackPlanId };
    case "SELECT_PLAN":
      return { ...state, selectedPlanId: event.planId };
    case "CREATE_REQUESTED":
      return { ...state, creating: true, createError: null };
    case "CREATE_FAILED":
      return { ...state, creating: false, createError: event.message };
    case "CREATE_FINISHED_WITHOUT_ID":
      return { ...state, creating: false, createError: "Agent creation did not return an agent id." };
    case "CLEAR_ERROR":
      return { ...state, createError: null };
    default:
      return state;
  }
}
