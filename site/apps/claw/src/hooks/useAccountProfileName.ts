"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createBrowserHyperCLIClient } from "@/lib/agent-client";

interface UseAccountProfileNameOptions {
  enabled: boolean;
  getToken: () => Promise<string>;
  userId: string | null;
}

interface ProfileNameState {
  userId: string;
  name: string | null;
}

export function useAccountProfileName({
  enabled,
  getToken,
  userId,
}: UseAccountProfileNameOptions) {
  const [state, setState] = useState<ProfileNameState | null>(null);
  const requestVersionRef = useRef(0);
  const localOverrideUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !userId) {
      requestVersionRef.current += 1;
      localOverrideUserIdRef.current = null;
      return;
    }
    if (localOverrideUserIdRef.current && localOverrideUserIdRef.current !== userId) {
      localOverrideUserIdRef.current = null;
    }
    if (localOverrideUserIdRef.current === userId) return;

    let active = true;
    const requestedUserId = userId;
    const requestVersion = ++requestVersionRef.current;
    void (async () => {
      try {
        const token = await getToken();
        const profile = await createBrowserHyperCLIClient(token).user.get();
        if (active && requestVersion === requestVersionRef.current) {
          setState({ userId: requestedUserId, name: profile.name?.trim() || null });
        }
      } catch {
        // Preserve the last known profile name when hydration is temporarily unavailable.
      }
    })();
    return () => {
      active = false;
    };
  }, [enabled, getToken, userId]);

  const setName = useCallback((name: string | null) => {
    if (!userId) return;
    requestVersionRef.current += 1;
    localOverrideUserIdRef.current = userId;
    setState({ userId, name: name?.trim() || null });
  }, [userId]);

  return {
    name: state?.userId === userId ? state.name : null,
    setName,
  };
}
