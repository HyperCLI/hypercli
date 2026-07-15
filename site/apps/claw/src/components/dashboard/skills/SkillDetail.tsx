"use client";

import * as React from "react";
import { ArrowLeft, FileText, Loader2, Save, Settings2, TestTube2 } from "lucide-react";
import {
  Button,
  toast,
} from "@hypercli/shared-ui";
import { SkillMarkdownEditor, SkillRequirementNotice, SkillStatusPill } from "@hypercli/shared-ui/skills";

import { SkillMarkdown } from "./SkillMarkdown";
import { SkillFilesPanel, type SkillResourceOperations } from "./SkillFilesPanel";
import {
  hasEnvValue,
  skillStatusLabel,
  type SkillConfigEntry,
  type SkillListRow,
} from "./skill-model";
import type { AgentSkill } from "./provider-skills";

interface SkillFrontmatterRow {
  key: string;
  value: string;
}

function frontmatterScalarValue(frontmatter: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = frontmatter.match(new RegExp(`^\\s*["']?${escaped}["']?\\s*:\\s*(.+?)\\s*$`, "mi"));
  const value = match?.[1]?.trim();
  if (!value || value === "|" || value === ">") return null;
  return value.replace(/,\s*$/, "").replace(/^["']|["']$/g, "");
}

function firstInlineFrontmatterRows(frontmatter: string): SkillFrontmatterRow[] {
  return frontmatter
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*["']?([a-zA-Z0-9_.-]+)["']?\s*:\s*(.+?)\s*$/))
    .filter((match): match is RegExpMatchArray => Boolean(match?.[1] && match?.[2]))
    .filter((match) => match[2] !== "|" && match[2] !== ">")
    .slice(0, 6)
    .map((match) => ({ key: match[1], value: match[2].replace(/,\s*$/, "").replace(/^["']|["']$/g, "") }));
}

function skillFrontmatterRows(skill: AgentSkill): SkillFrontmatterRow[] {
  const rows: SkillFrontmatterRow[] = [];
  const seen = new Set<string>();
  const add = (key: string, value: string | null | undefined) => {
    if (!value || seen.has(key)) return;
    seen.add(key);
    rows.push({ key, value });
  };

  add("requires.env", skill.requiresEnv.join(", "));
  add("requires.bins", skill.requiresBins.join(", "));
  add("os", skill.os.join(", "));
  add("primaryEnv", frontmatterScalarValue(skill.frontmatter, "primaryEnv"));
  add("user-invocable", frontmatterScalarValue(skill.frontmatter, "user-invocable"));
  add("model-invocable", frontmatterScalarValue(skill.frontmatter, "model-invocable"));
  add("homepage", skill.homepage);

  return rows.length > 0 ? rows.slice(0, 8) : firstInlineFrontmatterRows(skill.frontmatter);
}

function SkillSetupInstruction({ skill }: { skill: AgentSkill }) {
  if (skill.requiresEnv.length > 0) {
    return <>Configure <code className="rounded-md border border-warning/30 bg-background/70 px-1.5 py-0.5 font-mono text-[10px] text-foreground">{skill.requiresEnv.join(", ")}</code>{" "}using the secure fields for this skill.</>;
  }
  if (skill.requiresBins.length > 0) {
    return <>Install <code className="rounded-md border border-warning/30 bg-background/70 px-1.5 py-0.5 font-mono text-[10px] text-foreground">{skill.requiresBins.join(", ")}</code> and make it available on PATH.</>;
  }
  if (skill.os.length > 0) return <>This skill is limited to {skill.os.join(", ")} hosts.</>;
  return <>Review the setup notes in this skill before enabling it.</>;
}

export interface SkillDetailProps {
  row: SkillListRow;
  configEntry: SkillConfigEntry;
  onBack: () => void;
  onTest: () => void;
  onConfigured: (skillId: string, entry: SkillConfigEntry) => void;
  onSaveContent: (content: string) => Promise<void>;
  onUpdateSkill?: (skillId: string, update: { enabled?: boolean; env?: Record<string, string> }) => Promise<void>;
  onLoadDocument?: () => Promise<unknown>;
  connected: boolean;
  isDesktopViewport: boolean;
  resourceOperations?: SkillResourceOperations;
  onSkillContentChanged: (content: string) => void;
  onLocalDirectoryCreated: (path: string) => void;
  onSaveToAgent?: (content: string) => Promise<void>;
}

export function SkillDetail({
  row,
  configEntry,
  onBack,
  onTest,
  onConfigured,
  onSaveContent,
  onUpdateSkill,
  onLoadDocument,
  connected,
  isDesktopViewport,
  resourceOperations,
  onSkillContentChanged,
  onLocalDirectoryCreated,
  onSaveToAgent,
}: SkillDetailProps) {
  const { skill } = row;
  const frontmatterRows = skillFrontmatterRows(skill);
  const localPreview = Boolean(row.localPreview);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const [envEdits, setEnvEdits] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [contentEdit, setContentEdit] = React.useState<string | null>(null);
  const [contentSaving, setContentSaving] = React.useState(false);
  const [contentError, setContentError] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState<"overview" | "files">("overview");
  const [persisting, setPersisting] = React.useState(false);
  const [persistError, setPersistError] = React.useState<string | null>(null);
  const envDraft = { ...(configEntry.env ?? {}), ...envEdits };
  const contentDraft = contentEdit ?? skill.content;
  const requiredEnvMissing = skill.requiresEnv.some((key) => !hasEnvValue(envDraft[key]));
  const canSaveSetup = !saving && !localPreview && Boolean(onUpdateSkill) && !requiredEnvMissing;
  const contentIsDirty = contentDraft !== skill.content;
  const capabilityLabels = [
    skill.hasScripts ? "Scripts" : null,
    skill.hasReferences ? "References" : null,
    skill.hasAssets ? "Assets" : null,
  ].filter(Boolean) as string[];
  const filesAvailable = localPreview || Boolean(skill.resourcesAvailable && resourceOperations);

  React.useEffect(() => {
    titleRef.current?.focus();
  }, []);

  React.useEffect(() => {
    if (localPreview || skill.documentState !== "idle" || !onLoadDocument) return;
    void onLoadDocument().catch(() => undefined);
  }, [localPreview, onLoadDocument, skill.documentState]);

  const handleSaveSetup = async () => {
    if (!canSaveSetup) return;
    setSaving(true);
    setSaveError(null);
    try {
      const enabled = row.status !== "disabled";
      const cleanEnv = Object.fromEntries(Object.entries(envDraft).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value.length > 0));
      if (!onUpdateSkill) throw new Error("Skill configuration is unavailable for this agent.");
      await onUpdateSkill(skill.id, { enabled, env: cleanEnv });
      onConfigured(skill.id, { enabled, env: cleanEnv });
      setEnvEdits({});
      toast.success(`${skill.name} configuration saved.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save skill configuration.";
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveContent = async () => {
    if (!contentIsDirty || !contentDraft.trim()) return;
    setContentSaving(true);
    setContentError(null);
    try {
      await onSaveContent(contentDraft);
      setContentEdit(null);
      setEditing(false);
      toast.success(localPreview ? `${skill.name} updated for this session.` : `${skill.name} saved to the agent.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save skill instructions.";
      setContentError(message);
      toast.error(message);
    } finally {
      setContentSaving(false);
    }
  };

  const selectTab = (tab: "overview" | "files") => {
    setActiveTab(tab);
    if (tab === "files") setEditing(false);
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, tab: "overview" | "files") => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextTab = event.key === "ArrowLeft" || event.key === "Home"
      ? "overview"
      : event.key === "ArrowRight" || event.key === "End"
        ? "files"
        : tab;
    selectTab(nextTab);
    globalThis.document.getElementById(`${skill.id}-${nextTab}-tab`)?.focus();
  };

  const handleSaveToAgent = async () => {
    if (!onSaveToAgent || persisting) return;
    setPersisting(true);
    setPersistError(null);
    try {
      await onSaveToAgent(contentDraft);
      toast.success(`${skill.name} saved to the agent.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save skill to the agent.";
      setPersistError(message);
      toast.error(message);
    } finally {
      setPersisting(false);
    }
  };

  return (
    <div className={`h-full min-h-0 bg-background text-foreground ${activeTab === "files" && filesAvailable ? "overflow-hidden" : "overflow-y-auto"}`}>
      <div className={`mx-auto w-full max-w-6xl px-4 py-4 sm:px-5 sm:py-5 ${activeTab === "files" && filesAvailable ? "flex h-full min-h-0 flex-col" : ""}`}>
        <Button type="button" variant="ghost" size="sm" onClick={onBack} className="mb-4 h-8 gap-1.5 px-2 text-xs text-text-muted hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />Back to Skills
        </Button>

        <header className="border-b border-border pb-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-low/60">
                {skill.emoji ? <span className="text-lg" aria-hidden="true">{skill.emoji}</span> : <FileText className="h-4 w-4 text-text-secondary" />}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 ref={titleRef} tabIndex={-1} className="truncate text-xl font-semibold leading-tight outline-none">{skill.name}</h1>
                  <SkillStatusPill label={skillStatusLabel(row.status)} tone={row.status} />
                </div>
                <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-text-muted">{skill.description}</p>
                <div className="mt-2 flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <span className="shrink-0 rounded-md border border-border bg-surface-low/45 px-2 py-1 text-[10px] text-text-secondary">{skill.category}</span>
                  <span className="shrink-0 font-mono text-[10px] text-text-muted">/{skill.id}</span>
                  <span className="shrink-0 font-mono text-[10px] text-text-muted">{row.origin}</span>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-nowrap items-center gap-1.5">
              {localPreview && onSaveToAgent && <Button type="button" size="sm" onClick={() => void handleSaveToAgent()} disabled={persisting} className="h-8 min-h-0 gap-1.5 px-2.5 text-[11px]">{persisting ? <Loader2 className="animate-spin" /> : <Save className="h-3.5 w-3.5" />}{persisting ? "Saving..." : "Save to agent"}</Button>}
              {skill.editable && <Button type="button" variant={editing ? "secondary" : "outline"} size="sm" onClick={() => { setActiveTab("overview"); setEditing(true); }} className="h-8 min-h-0 gap-1.5 px-2.5 text-[11px] hover:bg-surface-high hover:text-foreground dark:hover:bg-surface-high"><Settings2 className="h-3.5 w-3.5" />Edit instructions</Button>}
              <Button type="button" variant="outline" size="sm" onClick={onTest} className="h-8 min-h-0 gap-1.5 px-2.5 text-[11px] hover:bg-surface-high hover:text-foreground dark:hover:bg-surface-high"><TestTube2 className="h-3.5 w-3.5" />Test in new session</Button>
            </div>
          </div>
        </header>
        {persistError && <p className="mt-3 rounded-lg border border-error/25 bg-error/10 px-3 py-2 text-[11px] text-error">{persistError}</p>}

        {filesAvailable && (
          <div role="tablist" aria-label={`${skill.name} details`} className="mt-4 flex gap-1 border-b border-border">
            {(["overview", "files"] as const).map((tab) => (
              <button
                key={tab}
                id={`${skill.id}-${tab}-tab`}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                aria-controls={`${skill.id}-${tab}-panel`}
                tabIndex={activeTab === tab ? 0 : -1}
                onClick={() => selectTab(tab)}
                onKeyDown={(event) => handleTabKeyDown(event, tab)}
                className={`border-b-2 px-3 py-2 text-xs font-medium capitalize transition-colors ${activeTab === tab ? "border-primary text-foreground" : "border-transparent text-text-muted hover:text-foreground"}`}
              >
                {tab}
              </button>
            ))}
          </div>
        )}

        {activeTab === "files" && filesAvailable ? (
          <div id={`${skill.id}-files-panel`} role="tabpanel" aria-labelledby={`${skill.id}-files-tab`} className="mt-4 min-h-0 flex-1 pb-1">
            <SkillFilesPanel
              skill={skill}
              localPreview={localPreview}
              connected={connected}
              isDesktopViewport={isDesktopViewport}
              operations={resourceOperations}
              onSkillContentChanged={onSkillContentChanged}
              onLocalDirectoryCreated={onLocalDirectoryCreated}
            />
          </div>
        ) : editing ? (
          <section id={`${skill.id}-overview-panel`} role={filesAvailable ? "tabpanel" : undefined} aria-labelledby={filesAvailable ? `${skill.id}-overview-tab` : undefined} className="mt-5 space-y-3">
            <div className="rounded-lg border border-border bg-surface-low/35 px-3 py-2 text-[11px] leading-relaxed text-text-muted">
              {localPreview ? "Changes apply only to this browser session and disappear on reload." : "Changes are saved directly to this skill on the running agent."}
            </div>
            <SkillMarkdownEditor
              value={contentDraft}
              onChange={(value) => { setContentEdit(value); setContentError(null); }}
              onApply={handleSaveContent}
              onCancel={() => { setContentEdit(null); setContentError(null); setEditing(false); }}
              dirty={contentIsDirty}
              saving={contentSaving}
              applyLabel={localPreview ? "Apply for this session" : "Save to agent"}
              renderPreview={(content) => <SkillMarkdown content={content} />}
            />
            {contentError && <p className="rounded-lg border border-error/25 bg-error/10 px-3 py-2 text-[11px] text-error">{contentError}</p>}
          </section>
        ) : (
          <div id={`${skill.id}-overview-panel`} role={filesAvailable ? "tabpanel" : undefined} aria-labelledby={filesAvailable ? `${skill.id}-overview-tab` : undefined} className="mt-5">
              <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="space-y-4">
                  {row.requirement && <SkillRequirementNotice title="Requirements need attention"><p>{row.requirement}</p><p className="mt-1 text-current/80"><SkillSetupInstruction skill={skill} /></p></SkillRequirementNotice>}
                  <section className="rounded-xl border border-border bg-surface-low/25 px-4 py-4">
                    <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">SKILL.md</h2>
                    {skill.documentState === "loading" || skill.documentState === "idle" ? (
                      <div role="status" className="flex items-center gap-2 text-[12px] text-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading instructions...</div>
                    ) : skill.documentState === "error" ? (
                      <div className="space-y-2">
                        <p className="text-[12px] leading-relaxed text-error">{skill.documentError || "Could not load skill instructions."}</p>
                        {onLoadDocument && <Button type="button" variant="outline" size="sm" onClick={() => void onLoadDocument().catch(() => undefined)}>Retry</Button>}
                      </div>
                    ) : skill.documentState === "unavailable" ? (
                      <p className="text-[12px] leading-relaxed text-text-muted">Detailed instructions are not exposed by this agent.</p>
                    ) : (
                      <SkillMarkdown content={skill.body || skill.content} />
                    )}
                  </section>
                </div>

                <aside className="space-y-4">
                  <section className="rounded-xl border border-border bg-surface-low/30 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xs font-semibold">Status</h2><SkillStatusPill label={skillStatusLabel(row.status)} tone={row.status} /></div>
                    <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
                      {localPreview ? row.status === "active" ? "Active for this browser session only. This local preview has not been installed on the agent." : "This is a local UI preview. It has not been installed on the agent yet." : row.status === "disabled" ? "This skill is disabled." : row.status === "blocked" ? "This skill is blocked for this agent." : row.status === "needs-setup" ? "This skill needs additional setup before it can run." : skill.documentState === "error" ? "Skill metadata is available, but its instructions could not be loaded." : "This skill is available for this agent."}
                    </p>
                  </section>

                  {skill.requiresEnv.length > 0 && !localPreview && onUpdateSkill && (
                    <section className="rounded-xl border border-border bg-surface-low/30 p-3">
                      <h2 className="text-xs font-semibold">Required environment</h2>
                      <p className="mt-1 text-[11px] leading-relaxed text-text-muted">Values are stored with this skill&apos;s agent configuration.</p>
                      <div className="mt-3 space-y-2">
                        {skill.requiresEnv.map((envKey) => (
                          <label key={envKey} className="block">
                            <span className="mb-1 block font-mono text-[10px] font-semibold text-warning">{envKey}</span>
                            <input type="password" value={envDraft[envKey] ?? ""} onChange={(event) => { setEnvEdits((prev) => ({ ...prev, [envKey]: event.target.value })); setSaveError(null); }} placeholder={`Enter ${envKey}`} className="h-9 w-full rounded-lg border border-border bg-background/75 px-3 font-mono text-[11px] text-foreground outline-none placeholder:text-text-muted focus:border-warning/60" />
                          </label>
                        ))}
                      </div>
                      {saveError && <p className="mt-3 text-[11px] text-error">{saveError}</p>}
                      <Button type="button" size="sm" onClick={handleSaveSetup} disabled={!canSaveSetup} title={requiredEnvMissing ? "Enter the required environment values first." : "Save skill configuration."} className="mt-3 w-full sm:w-auto">{saving ? <Loader2 className="animate-spin" /> : null}{saving ? "Saving..." : "Save configuration"}</Button>
                    </section>
                  )}

                  <section>
                    <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Capabilities</h2>
                    <div className="flex flex-nowrap gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <span className="shrink-0 rounded-md border border-border bg-surface-low/45 px-2 py-1 text-[10px] text-text-secondary">{skill.category}</span>
                      {capabilityLabels.length > 0 ? capabilityLabels.map((label) => <span key={label} className="shrink-0 rounded-md border border-border bg-surface-low/45 px-2 py-1 text-[10px] text-text-secondary">{label}</span>) : <span className="text-[10px] text-text-muted">Instruction-only skill</span>}
                    </div>
                  </section>

                  {frontmatterRows.length > 0 && (
                    <section>
                      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Frontmatter</h2>
                      <dl className="space-y-2 rounded-xl border border-border bg-surface-low/25 p-3">
                        {frontmatterRows.map((item) => <div key={item.key} className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-2"><dt className="truncate font-mono text-[10px] leading-6 text-text-muted">{item.key}</dt><dd className="min-w-0"><code className="inline-block max-w-full truncate rounded-md border border-border bg-background/70 px-1.5 py-1 font-mono text-[10px] leading-none text-foreground">{item.value}</code></dd></div>)}
                      </dl>
                    </section>
                  )}
                </aside>
              </div>
          </div>
        )}
      </div>
    </div>
  );
}
