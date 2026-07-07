"use client";

import {
  AgentFilesPanel as SharedAgentFilesPanel,
  type AgentFilesPanelProps,
} from "@hypercli/shared-ui/files";

import { MarkdownContent } from "@/components/dashboard/chat/MarkdownContent";
import { normalizeOpenClawMediaFilePath, normalizeOpenClawWorkspaceFilePath } from "@/lib/agent-file-path";
import { isProtectedFile } from "@/lib/protected-files";

export type {
  AgentFileOpenResponse,
  AgentFileOpenResult,
  AgentFilesPanelProps,
  AgentFilesPanelSource,
  AgentFilesPanelSourceDisabledReasons,
} from "@hypercli/shared-ui/files";

function renderMarkdown(content: string, className?: string) {
  return <MarkdownContent content={content} className={className} />;
}

export function AgentFilesPanel({
  rootPath,
  initialPreviewPath,
  isReadOnlyFile,
  renderMarkdown: renderMarkdownOverride,
  ...props
}: AgentFilesPanelProps) {
  return (
    <SharedAgentFilesPanel
      {...props}
      rootPath={rootPath ? normalizeOpenClawWorkspaceFilePath(rootPath) : rootPath}
      initialPreviewPath={initialPreviewPath ? normalizeOpenClawMediaFilePath(initialPreviewPath) : initialPreviewPath}
      isReadOnlyFile={isReadOnlyFile ?? isProtectedFile}
      renderMarkdown={renderMarkdownOverride ?? renderMarkdown}
    />
  );
}
