"use client";

import type { ComponentProps } from "react";

import { FirstAgentSetupWizard, type FirstAgentSetupCreateParams } from "./FirstAgentSetupWizard";

export type AgentCreationSetupCreateParams = FirstAgentSetupCreateParams;

export type AgentCreationSetupWizardProps = Omit<
  ComponentProps<typeof FirstAgentSetupWizard>,
  "enableCustomImageOption" | "showProFeatureLabels"
>;

export function AgentCreationSetupWizard(props: AgentCreationSetupWizardProps) {
  return (
    <FirstAgentSetupWizard
      {...props}
      enforceProFeaturePlanRestrictions
      enableCustomImageOption
      showProFeatureLabels
    />
  );
}
