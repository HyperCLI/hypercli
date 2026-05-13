import type { HyperAgentPlan } from "@hypercli.com/sdk/agent";

type CatalogPlan = HyperAgentPlan & {
  deprecated?: boolean;
  hidden?: boolean;
  legacy?: boolean;
  meta?: {
    deprecated?: boolean | null;
    hidden?: boolean | null;
    legacy?: boolean | null;
  } | null;
};

export function normalizedPlanWords(value: string | null | undefined): string[] {
  return String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function hasPlanWord(value: string | null | undefined, word: string): boolean {
  return normalizedPlanWords(value).includes(word);
}

function labelMatchesFiveAiu(value: string | null | undefined): boolean {
  const words = normalizedPlanWords(value);
  return words.includes("5aiu") || words.some((word, index) => word === "5" && words[index + 1] === "aiu");
}

export function isLegacyAgentPlanLabel(value: string | null | undefined): boolean {
  return labelMatchesFiveAiu(value) || hasPlanWord(value, "legacy");
}

export function isFiveAiuPlan(plan: HyperAgentPlan): boolean {
  return labelMatchesFiveAiu(plan.id) || labelMatchesFiveAiu(plan.name);
}

export function isLegacyAgentPlan(plan: HyperAgentPlan | null | undefined): boolean {
  if (!plan) return false;
  const catalogPlan = plan as CatalogPlan;
  return Boolean(
      catalogPlan.legacy ||
      catalogPlan.deprecated ||
      catalogPlan.meta?.legacy ||
      catalogPlan.meta?.deprecated ||
      isLegacyAgentPlanLabel(plan.id) ||
      isLegacyAgentPlanLabel(plan.name) ||
      isFiveAiuPlan(plan),
  );
}

export function isVisibleCurrentAgentPlan(plan: HyperAgentPlan | null | undefined): plan is HyperAgentPlan {
  if (!plan) return false;
  const catalogPlan = plan as CatalogPlan;
  return !catalogPlan.hidden && !catalogPlan.meta?.hidden && !isLegacyAgentPlan(plan);
}
