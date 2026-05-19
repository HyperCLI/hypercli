import { describe, expect, it } from "vitest";

import {
  createFirstAgentWizardState,
  firstAgentWizardReducer,
} from "./first-agent-wizard-machine";

describe("first agent wizard machine", () => {
  it("creates an initial state from the first selectable plan", () => {
    expect(createFirstAgentWizardState("pro")).toEqual({
      stepIndex: 0,
      selectedPlanId: "pro",
      creating: false,
      createError: null,
    });
  });

  it("bounds step transitions", () => {
    const state = createFirstAgentWizardState("pro");

    expect(firstAgentWizardReducer(state, { type: "GO_TO_STEP", stepIndex: 10, maxStepIndex: 2 }).stepIndex).toBe(2);
    expect(firstAgentWizardReducer(state, { type: "GO_TO_STEP", stepIndex: -1, maxStepIndex: 2 }).stepIndex).toBe(0);
  });

  it("keeps or replaces selected plans when options change", () => {
    const state = firstAgentWizardReducer(
      createFirstAgentWizardState("pro"),
      { type: "SELECT_PLAN", planId: "team" },
    );

    expect(
      firstAgentWizardReducer(state, {
        type: "PLAN_OPTIONS_CHANGED",
        planIds: ["starter", "team"],
        fallbackPlanId: "starter",
      }).selectedPlanId,
    ).toBe("team");

    expect(
      firstAgentWizardReducer(state, {
        type: "PLAN_OPTIONS_CHANGED",
        planIds: ["starter"],
        fallbackPlanId: "starter",
      }).selectedPlanId,
    ).toBe("starter");
  });

  it("models create request failures", () => {
    const creating = firstAgentWizardReducer(createFirstAgentWizardState("pro"), { type: "CREATE_REQUESTED" });
    expect(creating).toMatchObject({ creating: true, createError: null });

    expect(
      firstAgentWizardReducer(creating, { type: "CREATE_FAILED", message: "No slot" }),
    ).toMatchObject({ creating: false, createError: "No slot" });
  });

  it("models create completion without an id", () => {
    const creating = firstAgentWizardReducer(createFirstAgentWizardState("pro"), { type: "CREATE_REQUESTED" });

    expect(
      firstAgentWizardReducer(creating, { type: "CREATE_FINISHED_WITHOUT_ID" }),
    ).toMatchObject({
      creating: false,
      createError: "Agent creation did not return an agent id.",
    });
  });

  it("clears errors without changing create progress", () => {
    const failed = firstAgentWizardReducer(
      createFirstAgentWizardState("pro"),
      { type: "CREATE_FAILED", message: "No slot" },
    );

    expect(firstAgentWizardReducer(failed, { type: "CLEAR_ERROR" })).toMatchObject({
      selectedPlanId: "pro",
      creating: false,
      createError: null,
    });
  });
});
