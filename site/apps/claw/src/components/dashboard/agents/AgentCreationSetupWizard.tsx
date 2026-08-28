"use client";

import { useCallback, useState, type ComponentProps } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@hypercli/shared-ui";

import { FirstAgentSetupWizard, type FirstAgentSetupCreateParams } from "./FirstAgentSetupWizard";

export type AgentCreationSetupCreateParams = FirstAgentSetupCreateParams;

export type AgentCreationSetupWizardProps = Omit<
  ComponentProps<typeof FirstAgentSetupWizard>,
  "enableCustomImageOption" | "showProFeatureLabels"
> & {
  dialogTestId?: string;
  overlayTestId?: string;
  suspended?: boolean;
};

export function AgentCreationSetupWizard(props: AgentCreationSetupWizardProps) {
  const {
    dialogTestId,
    overlayTestId,
    suspended = false,
    ...wizardProps
  } = props;
  const [creating, setCreating] = useState(false);
  const interactionLocked = Boolean(wizardProps.checkoutProcessing || creating);
  const handleCreatingChange = useCallback((nextCreating: boolean) => {
    setCreating(nextCreating);
    wizardProps.onCreatingChange?.(nextCreating);
  }, [wizardProps.onCreatingChange]);
  const closeWizard = () => {
    if (!interactionLocked) wizardProps.onClose?.();
  };

  const wizard = (
    <FirstAgentSetupWizard
      {...wizardProps}
      onClose={wizardProps.onClose ? closeWizard : undefined}
      onCreatingChange={handleCreatingChange}
      size="modal"
      suspended={suspended}
      enforceProFeaturePlanRestrictions
      enableCustomImageOption
      showProFeatureLabels
    />
  );

  if (wizardProps.size === "embedded") {
    return (
      <div
        aria-hidden={suspended || undefined}
        data-slot="agent-creation-workspace"
        className={`flex h-full min-h-0 w-full min-w-0 flex-1 bg-background p-3 sm:p-4 lg:p-5 ${suspended ? "invisible pointer-events-none" : ""}`}
      >
        <div className="h-full min-h-0 w-full overflow-hidden rounded-[18px] border border-border bg-background-secondary shadow-[0_18px_55px_rgb(0_0_0_/_0.28)] sm:rounded-[22px]">
          {wizard}
        </div>
      </div>
    );
  }

  return (
    <Dialog open={!suspended} onOpenChange={(open) => { if (!open && !suspended) closeWizard(); }}>
      <DialogContent
        forceMount
        data-testid={dialogTestId}
        aria-hidden={suspended || undefined}
        closeLabel="Close agent creation"
        showCloseButton={false}
        overlayProps={{
          "aria-hidden": suspended || undefined,
          "data-testid": overlayTestId,
        }}
        overlayClassName={`z-[9998] bg-black/85 backdrop-blur-[2px] ${suspended ? "invisible pointer-events-none" : ""}`}
        className={`z-[9999] block h-[calc(100dvh-0.75rem)] w-[calc(100%-0.75rem)] max-w-none gap-0 overflow-hidden rounded-[18px] border-border bg-background-secondary p-0 shadow-[0_28px_90px_rgb(0_0_0_/_0.55)] sm:h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)] sm:max-w-none sm:rounded-[24px] 2xl:h-[calc(100dvh-3.5rem)] 2xl:w-[calc(100%-3.5rem)] 2xl:max-w-none ${suspended ? "invisible pointer-events-none" : ""}`}
        onOpenAutoFocus={(event) => {
          if (suspended) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (interactionLocked || suspended) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (interactionLocked || suspended) event.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">Agent creation</DialogTitle>
        <DialogDescription className="sr-only">Configure an agent, choose capacity, and complete checkout without leaving this dialog.</DialogDescription>
        {wizard}
      </DialogContent>
    </Dialog>
  );
}
