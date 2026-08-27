import {
  isTeamTrialCheckoutFlow,
  type CheckoutReflectionStatus,
  type PendingPlanCheckout,
} from "@/lib/plan-checkout-state";

export type CheckoutSyncBanner = {
  status: "syncing" | "success" | "pending" | "cancelled";
  message: string;
};

export type BillingReflectionState =
  | { status: "idle" }
  | { status: "syncing"; pending: PendingPlanCheckout | null; message: string }
  | { status: "pending"; pending: PendingPlanCheckout | null; reason: "waiting-payment" | "waiting-entitlement" | "setup-failed"; message: string }
  | { status: "success"; pending: PendingPlanCheckout | null; message: string }
  | { status: "cancelled"; message: string };

export type BillingReflectionEvent =
  | { type: "SYNC_STARTED"; pending: PendingPlanCheckout | null; message: string }
  | { type: "REFLECTION_RECEIVED"; pending: PendingPlanCheckout | null; reflectionStatus: CheckoutReflectionStatus }
  | { type: "RECOVERY_FAILED"; pending: PendingPlanCheckout }
  | { type: "CHECKOUT_CANCELLED" }
  | { type: "DISMISS" };

export const initialBillingReflectionState: BillingReflectionState = { status: "idle" };

export function billingReflectionReducer(
  state: BillingReflectionState,
  event: BillingReflectionEvent,
): BillingReflectionState {
  switch (event.type) {
    case "SYNC_STARTED":
      return {
        status: "syncing",
        pending: event.pending,
        message: event.message,
      };
    case "REFLECTION_RECEIVED":
      if (event.reflectionStatus === "ready") {
        const trialActive = isTeamTrialCheckoutFlow(event.pending);
        return {
          status: "success",
          pending: event.pending,
          message: trialActive
            ? `${event.pending?.planName ?? "Your"} trial is active. Agent slots and limits are ready.`
            : `${event.pending?.planName ?? "Your plan"} is active. Agent slots and limits are updated.`,
        };
      }
      if (event.reflectionStatus === "waiting-entitlement") {
        const trialActive = isTeamTrialCheckoutFlow(event.pending);
        return {
          status: "pending",
          pending: event.pending,
          reason: "waiting-entitlement",
          message: trialActive
            ? "Trial active. Waiting for agent slots to finish provisioning before an agent can be created."
            : "Payment active. Waiting for launch entitlements to finish provisioning before agents can be created.",
        };
      }
      if (isTeamTrialCheckoutFlow(event.pending)) {
        return {
          status: "pending",
          pending: event.pending,
          reason: "waiting-payment",
          message: "Trial checkout completed. Billing is still activating the Team trial.",
        };
      }
      return {
        status: "pending",
        pending: event.pending,
        reason: "waiting-payment",
        message: "Payment succeeded. Billing is still updating, so this page will keep showing the latest plan data.",
      };
    case "RECOVERY_FAILED":
      return {
        status: "pending",
        pending: event.pending,
        reason: "setup-failed",
        message: "Payment is active, but agent setup did not finish. Refresh to safely retry the saved setup.",
      };
    case "CHECKOUT_CANCELLED":
      return {
        status: "cancelled",
        message: "Checkout cancelled. No plan changes were made.",
      };
    case "DISMISS":
      return initialBillingReflectionState;
    default:
      return state;
  }
}

export function checkoutSyncBannerFromBillingState(
  state: BillingReflectionState,
): CheckoutSyncBanner | null {
  if (state.status === "idle") return null;
  return {
    status: state.status,
    message: state.message,
  };
}
