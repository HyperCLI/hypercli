"use client";

import * as React from "react";
import { AgentFilesPanel as SharedAgentFilesPanel, type FileEntry } from "@hypercli/shared-ui/files";
import type { AgentSkillResourceEntry } from "@hypercli.com/sdk/skills";

import { SkillMarkdown } from "./SkillMarkdown";
import type { AgentSkill } from "./provider-skills";

export interface SkillResourceOperations {
  listResources: (skillId: string, path?: string) => Promise<AgentSkillResourceEntry[]>;
  readResource: (skillId: string, path: string) => Promise<Uint8Array>;
  writeResource?: (skillId: string, path: string, content: Uint8Array) => Promise<void>;
  deleteResource?: (skillId: string, path: string, options?: { recursive?: boolean }) => Promise<void>;
  createResourceDirectory?: (skillId: string, path: string) => Promise<void>;
}

interface SkillFilesPanelProps {
  skill: AgentSkill;
  localPreview: boolean;
  connected: boolean;
  isDesktopViewport?: boolean;
  operations?: SkillResourceOperations;
  onSkillContentChanged: (content: string) => void;
  onLocalDirectoryCreated?: (path: string) => void;
}

function renderMarkdown(content: string, className?: string) {
  return <div className={className}><SkillMarkdown content={content} /></div>;
}

export function SkillFilesPanel({
  skill,
  localPreview,
  connected,
  isDesktopViewport,
  operations,
  onSkillContentChanged,
  onLocalDirectoryCreated,
}: SkillFilesPanelProps) {
  const canAccessInstalledFiles = connected && Boolean(operations) && skill.resourceAccess !== "none";
  const canWrite = !localPreview
    && skill.resourceAccess === "read-write"
    && Boolean(operations?.writeResource && operations.deleteResource && operations.createResourceDirectory);
  const browserConnected = localPreview || canAccessInstalledFiles;
  const localEntry: FileEntry = { name: "SKILL.md", path: "SKILL.md", type: "file" };
  const localDirectoriesRef = React.useRef(skill.localDirectories ?? []);

  const localDirectoryEntries = (path: string): FileEntry[] => localDirectoriesRef.current
    .filter((directory) => {
      const separator = directory.lastIndexOf("/");
      const parent = separator >= 0 ? directory.slice(0, separator) : "";
      return parent === path;
    })
    .map((directory) => ({
      name: directory.split("/").pop() ?? directory,
      path: directory,
      type: "directory" as const,
    }));

  const listFiles = async (path?: string) => {
    const relativePath = path ?? "";
    if (localPreview) return relativePath ? localDirectoryEntries(relativePath) : [localEntry, ...localDirectoryEntries("")];
    if (!operations) return [];
    return operations.listResources(skill.id, relativePath);
  };

  const readFile = async (path: string) => {
    if (localPreview) {
      if (path !== "SKILL.md") throw new Error("Local previews only contain SKILL.md.");
      return skill.content;
    }
    if (!operations) throw new Error("Skill files are unavailable for this agent.");
    return new TextDecoder().decode(await operations.readResource(skill.id, path));
  };

  const readFileBytes = localPreview || !operations ? undefined : async (path: string) => (
    operations.readResource(skill.id, path)
  );

  const saveFile = !canWrite ? undefined : async (path: string, content: string) => {
    await operations!.writeResource!(skill.id, path, new TextEncoder().encode(content));
    if (path === "SKILL.md") onSkillContentChanged(content);
  };

  const uploadFile = !canWrite ? undefined : async (path: string, content: Uint8Array) => {
    await operations!.writeResource!(skill.id, path, content);
  };

  const deleteFile = !canWrite ? undefined : async (path: string, options?: { recursive?: boolean }) => {
    await operations!.deleteResource!(skill.id, path, options);
  };

  const createDirectory = localPreview && onLocalDirectoryCreated
    ? async (path: string) => {
        if (localDirectoriesRef.current.includes(path)) throw new Error("A folder with this name already exists.");
        localDirectoriesRef.current = [...localDirectoriesRef.current, path].sort();
        onLocalDirectoryCreated(path);
      }
    : !canWrite
      ? undefined
      : async (path: string) => {
          await operations!.createResourceDirectory!(skill.id, path);
        };

  return (
    <div data-slot="skill-files-panel" className="h-full min-h-0 overflow-hidden rounded-xl border border-border bg-background">
      <SharedAgentFilesPanel
        key={`${skill.id}:${localPreview ? "preview" : skill.resourceAccess}`}
        agentId={localPreview ? `local:${skill.id}` : undefined}
        agentName={`${skill.name} files`}
        connected={browserConnected}
        defaultSource="agent"
        showSourceTabs={false}
        isDesktopViewport={isDesktopViewport}
        error={!localPreview && !canAccessInstalledFiles ? "Skill files are unavailable for this agent." : null}
        onListFiles={listFiles}
        onOpenFile={readFile}
        onOpenFileBytes={readFileBytes}
        onDownloadFileBytes={readFileBytes}
        onSaveFile={saveFile}
        onDeleteFile={deleteFile}
        onUploadFile={uploadFile}
        onCreateDirectory={createDirectory}
        isReadOnlyFile={() => !canWrite}
        readOnlyLabel={localPreview ? "Local preview" : !canWrite ? "Read-only skill" : undefined}
        readOnlyDescription={localPreview
          ? "This is a browser-only preview. Draft folders and instruction changes last for this session only."
          : !canWrite
            ? "Original skill files can be viewed and downloaded, but not changed."
            : undefined}
        renderMarkdown={renderMarkdown}
      />
    </div>
  );
}
