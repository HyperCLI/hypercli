import { FileText, PackageCheck, Wrench } from "lucide-react";
import type { SkillCardBadge, SkillCardModel, SkillCardOrigin } from "@hypercli/shared-ui/skills";

import type { AgentSkill } from "./provider-skills";

export type SkillStatus = "active" | "disabled" | "needs-setup" | "blocked" | "preview";
export type SkillStatusFilter = "all" | SkillStatus;

export interface SkillListRow {
  skill: AgentSkill;
  status: SkillStatus;
  origin: SkillCardOrigin;
  requirement: string | null;
  localPreview?: boolean;
}

export interface SkillConfigEntry {
  enabled?: boolean;
  env?: Record<string, string>;
}

export function hasEnvValue(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function getSkillConfigEntry(
  skillId: string,
  overrides: Record<string, SkillConfigEntry> = {},
): SkillConfigEntry {
  const override = overrides[skillId];
  return {
    enabled: override?.enabled,
    env: override?.env ?? {},
  };
}

export function formatSkillRequirement(skill: AgentSkill, entry?: SkillConfigEntry): string | null {
  const requirements: string[] = [];
  const reportedMissingEnv = skill.localPreview ? skill.requiresEnv : skill.missingRequirements.env;
  const missingEnv = entry ? reportedMissingEnv.filter((key) => !hasEnvValue(entry.env?.[key])) : reportedMissingEnv;
  if (missingEnv.length > 0) requirements.push(missingEnv.join(", "));
  const missingBins = skill.localPreview ? skill.requiresBins : skill.missingRequirements.bins;
  const missingOs = skill.localPreview ? skill.os : skill.missingRequirements.os;
  if (missingBins.length > 0) requirements.push(`${missingBins.join(", ")} on PATH`);
  if (missingOs.length > 0) requirements.push(`${missingOs.join(", ")} only`);
  if (requirements.length > 0) return `Requires ${requirements.join("; ")}`;
  if (skill.installHints.length > 0) return "Setup instructions available";
  return null;
}

export function statusForSkill(
  skill: AgentSkill,
  overrides: Record<string, SkillConfigEntry> = {},
): SkillStatus {
  const entry = getSkillConfigEntry(skill.id, overrides);
  if (entry.enabled === false || (entry.enabled === undefined && skill.availability === "disabled")) return "disabled";
  if (skill.availability === "blocked") return "blocked";
  if (skill.availability === "needs-setup") return "needs-setup";
  return "active";
}

export function skillStatusLabel(status: SkillStatus): string {
  if (status === "disabled") return "Disabled";
  if (status === "needs-setup") return "Needs setup";
  if (status === "blocked") return "Blocked";
  if (status === "preview") return "Preview";
  return "Active";
}

function skillBadges(skill: AgentSkill): SkillCardBadge[] {
  return [
    skill.hasScripts ? { label: "Scripts", icon: Wrench } : null,
    skill.hasReferences ? { label: "References", icon: FileText } : null,
    skill.hasAssets ? { label: "Assets", icon: PackageCheck } : null,
    skill.requiresBins.length > 0 ? { label: `${skill.requiresBins.length} bin${skill.requiresBins.length === 1 ? "" : "s"}`, icon: PackageCheck, tone: "needs-setup" as const } : null,
  ].filter(Boolean) as SkillCardBadge[];
}

export function skillCardForRow(row: SkillListRow): SkillCardModel {
  return {
    id: row.skill.id,
    name: row.skill.name,
    description: row.skill.description,
    category: row.skill.category,
    emoji: row.skill.emoji,
    origin: row.origin,
    status: row.status,
    statusLabel: skillStatusLabel(row.status),
    statusTone: row.status,
    badges: skillBadges(row.skill),
  };
}
