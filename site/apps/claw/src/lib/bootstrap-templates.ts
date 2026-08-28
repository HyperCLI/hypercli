// Assembles the canonical bootstrap Markdown pack from the static templates
// in public/bootstrap/. Templates ship as source assets and are embedded at
// compile time as raw strings — no runtime fetch, no API traffic. The same
// files are also served statically for inspection and reused verbatim by the
// test setup. BOOTSTRAP.md is fully static and passes through untouched; the
// rest carry {{token}} placeholders interpolated from onboarding answers.
import {
  OPENCLAW_BOOTSTRAP_OPTIONAL_FILES,
  OPENCLAW_BOOTSTRAP_REQUIRED_FILES,
  OPENCLAW_BOOTSTRAP_STAGED_REQUIRED_FILES,
  type OpenClawBootstrapFile,
  type OpenClawBootstrapFileName,
  type OpenClawBootstrapInputs,
} from "@/lib/openclaw-bootstrap-pack";
import { debugFlow } from "@/lib/debug-flow";
import agentsTemplate from "../../public/bootstrap/AGENTS.md";
import bootstrapTemplate from "../../public/bootstrap/BOOTSTRAP.md";
import identityTemplate from "../../public/bootstrap/IDENTITY.md";
import memoryTemplate from "../../public/bootstrap/MEMORY.md";
import soulTemplate from "../../public/bootstrap/SOUL.md";
import userTemplate from "../../public/bootstrap/USER.md";

const BOOTSTRAP_TEMPLATES: Record<OpenClawBootstrapFileName, string> = {
  "AGENTS.md": agentsTemplate,
  "BOOTSTRAP.md": bootstrapTemplate,
  "IDENTITY.md": identityTemplate,
  "MEMORY.md": memoryTemplate,
  "SOUL.md": soulTemplate,
  "USER.md": userTemplate,
};

const clean = (value: unknown, maxLength = 2_000): string =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const bullet = (value: string, fallback: string): string => clean(value) || fallback;

function buildTemplateTokens(inputs: OpenClawBootstrapInputs): Record<string, string> {
  const userBasics = [
    inputs.userName ? `- **Name / what to call them:** ${inputs.userName}` : "- **Name / what to call them:** Not provided yet.",
    inputs.timezone ? `- **Timezone:** ${inputs.timezone}` : "- **Timezone:** Not provided yet.",
    inputs.companyRole ? `- **Company / role:** ${inputs.companyRole}` : "- **Company / role:** Not provided yet.",
  ].join("\n");
  return {
    agentName: inputs.agentName,
    purpose: bullet(inputs.purpose, "Help the user make useful progress."),
    tone: bullet(inputs.tone, "Clear, direct, thoughtful, and collaborative."),
    autonomy: bullet(inputs.autonomy, "Ask before consequential external actions."),
    escalation: bullet(inputs.escalation, "Ask when the right action is unclear."),
    trustedSources: bullet(inputs.trustedSources, "Prefer current workspace files and user-provided sources."),
    responseStyle: bullet(inputs.responseStyle, "Lead with the answer and use detail when it helps."),
    toolsNotes: inputs.toolsNotes
      ? clean(inputs.toolsNotes)
      : "No environment-specific tool notes were provided. Inspect the available tools and ask before assuming access.",
    userBasics,
    memoryNotes: clean(inputs.memoryNotes),
  };
}

export function interpolateBootstrapTemplate(template: string, tokens: Record<string, string>): string {
  let output = template;
  for (const [key, value] of Object.entries(tokens)) {
    output = output.split(`{{${key}}}`).join(value);
  }
  if (output.includes("{{")) {
    debugFlow("bootstrap-templates", "template has unresolved tokens", {
      preview: output.slice(Math.max(output.indexOf("{{") - 40, 0), output.indexOf("{{") + 40),
    });
  }
  return output;
}

/**
 * Assemble the full canonical pack from the static templates. BOOTSTRAP.md is
 * static by contract; the other files are interpolated from onboarding inputs.
 * Synchronous: templates are embedded at build time.
 */
export function assembleOpenClawBootstrapPack(
  inputs: OpenClawBootstrapInputs,
): OpenClawBootstrapFile[] {
  const tokens = buildTemplateTokens(inputs);
  const names: OpenClawBootstrapFileName[] = [
    ...OPENCLAW_BOOTSTRAP_REQUIRED_FILES,
    ...(inputs.includeMemory && inputs.memoryNotes ? OPENCLAW_BOOTSTRAP_OPTIONAL_FILES : []),
  ];
  return names.map((name) => ({
    name,
    content: name === "BOOTSTRAP.md" ? BOOTSTRAP_TEMPLATES[name] : interpolateBootstrapTemplate(BOOTSTRAP_TEMPLATES[name], tokens),
  }));
}

/**
 * Assemble the minimal native-bootstrap pack for users who skip creation
 * onboarding. It writes only files that are not completion evidence, so
 * OpenClaw performs its own first-run onboarding before creating profile files.
 */
export function assembleOpenClawStagedDefaultBootstrapPack(
  inputs: OpenClawBootstrapInputs,
): OpenClawBootstrapFile[] {
  const tokens = buildTemplateTokens(inputs);
  return OPENCLAW_BOOTSTRAP_STAGED_REQUIRED_FILES.map((name) => ({
    name,
    content: name === "BOOTSTRAP.md" ? BOOTSTRAP_TEMPLATES[name] : interpolateBootstrapTemplate(BOOTSTRAP_TEMPLATES[name], tokens),
  }));
}
