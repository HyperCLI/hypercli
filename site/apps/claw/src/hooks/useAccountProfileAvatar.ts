"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createBrowserHyperCLIClient } from "@/lib/agent-client";

interface UseAccountProfileAvatarOptions {
  enabled: boolean;
  getToken: () => Promise<string>;
  userId: string | null;
}

interface ProfileAvatarState {
  userId: string;
  avatarUrl: string | null;
}

export function useAccountProfileAvatar({
  enabled,
  getToken,
  userId,
}: UseAccountProfileAvatarOptions) {
  const [state, setState] = useState<ProfileAvatarState | null>(null);
  const requestVersionRef = useRef(0);
  const objectUrlRef = useRef<string | null>(null);
  const localOverrideUserIdRef = useRef<string | null>(null);

  const revokeObjectUrl = useCallback(() => {
    if (!objectUrlRef.current) return;
    URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
  }, []);

  useEffect(() => {
    if (!enabled || !userId) {
      requestVersionRef.current += 1;
      localOverrideUserIdRef.current = null;
      revokeObjectUrl();
      return;
    }

    if (localOverrideUserIdRef.current && localOverrideUserIdRef.current !== userId) {
      localOverrideUserIdRef.current = null;
      revokeObjectUrl();
    }

    if (localOverrideUserIdRef.current === userId) return;

    let active = true;
    const requestedUserId = userId;
    const requestVersion = ++requestVersionRef.current;

    const loadProfileAvatar = async () => {
      try {
        const token = await getToken();
        const client = createBrowserHyperCLIClient(token);
        const profileImage = await client.user.getProfileImage();
        if (active && requestVersion === requestVersionRef.current) {
          revokeObjectUrl();
          setState({ userId: requestedUserId, avatarUrl: profileImage.avatarUrl ?? null });
        }
      } catch {
        // Preserve the last known avatar when profile hydration is temporarily unavailable.
      }
    };

    void loadProfileAvatar();
    return () => {
      active = false;
    };
  }, [enabled, getToken, revokeObjectUrl, userId]);

  const setAvatarUrl = useCallback((avatarUrl: string | null, file?: File) => {
    if (!userId) return;
    requestVersionRef.current += 1;
    localOverrideUserIdRef.current = userId;
    revokeObjectUrl();
    let displayUrl = avatarUrl;
    if (file) {
      displayUrl = URL.createObjectURL(file);
      objectUrlRef.current = displayUrl;
    }
    setState({ userId, avatarUrl: displayUrl });
  }, [revokeObjectUrl, userId]);

  useEffect(() => revokeObjectUrl, [revokeObjectUrl]);

  return {
    avatarUrl: state?.userId === userId ? state.avatarUrl : null,
    setAvatarUrl,
  };
}
