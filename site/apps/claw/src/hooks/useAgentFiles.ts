"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useHyperCLI } from "./useHyperCLI";
import type { AgentFileEntry } from "@/types";

export const agentFilesKeys = {
  list: (agentId: string, prefix?: string) => ["agent-files", agentId, prefix ?? ""] as const,
};

export function useAgentFiles(agentId: string | null, prefix?: string) {
  const { deployments, ready } = useHyperCLI();
  const queryClient = useQueryClient();

  const {
    data,
    isLoading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: agentFilesKeys.list(agentId ?? "", prefix),
    queryFn: async (): Promise<AgentFileEntry[]> => {
      if (!deployments || !agentId) throw new Error("SDK not ready");
      return deployments.filesList(agentId, prefix);
    },
    enabled: ready && !!deployments && !!agentId,
  });

  const entries = data ?? [];
  const directories = entries.filter((e) => e.type === "directory");
  const files = entries.filter((e) => e.type === "file");
  const error = queryError ? (queryError instanceof Error ? queryError.message : String(queryError)) : null;

  const uploadMutation = useMutation({
    mutationFn: async ({ path, content }: { path: string; content: string }) => {
      if (!deployments || !agentId) throw new Error("SDK not ready");
      return deployments.fileWrite(agentId, path, content);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentFilesKeys.list(agentId ?? "", prefix) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ path, recursive }: { path: string; recursive?: boolean }) => {
      if (!deployments || !agentId) throw new Error("SDK not ready");
      return deployments.fileDelete(agentId, path, recursive ? { recursive } : undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentFilesKeys.list(agentId ?? "", prefix) });
    },
  });

  const uploadFile = useCallback(
    async (path: string, content: string) => uploadMutation.mutateAsync({ path, content }),
    [uploadMutation],
  );

  const deleteFile = useCallback(
    async (path: string, options?: { recursive?: boolean }) =>
      deleteMutation.mutateAsync({ path, recursive: options?.recursive }),
    [deleteMutation],
  );

  const downloadFile = useCallback(
    async (path: string): Promise<Uint8Array> => {
      if (!deployments || !agentId) throw new Error("SDK not ready");
      return deployments.fileReadBytes(agentId, path);
    },
    [deployments, agentId],
  );

  const readFile = useCallback(
    async (path: string): Promise<string> => {
      if (!deployments || !agentId) throw new Error("SDK not ready");
      return deployments.fileRead(agentId, path);
    },
    [deployments, agentId],
  );

  return {
    entries,
    directories,
    files,
    isLoading,
    error,
    refetch,
    uploadFile,
    deleteFile,
    downloadFile,
    readFile,
    isUploading: uploadMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
