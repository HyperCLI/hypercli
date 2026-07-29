"use client";

import { useCallback, useEffect, useState } from "react";

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

  useEffect(() => {
    if (!enabled || !userId) return;

    let active = true;
    const requestedUserId = userId;

    const loadProfileAvatar = async () => {
      try {
        const token = await getToken();
        const client = createBrowserHyperCLIClient(token);
        const profileImage = await client.user.getProfileImage();
        if (active) {
          setState({ userId: requestedUserId, avatarUrl: profileImage.avatarUrl ?? null });
        }
      } catch {
        if (active) setState({ userId: requestedUserId, avatarUrl: null });
      }
    };

    void loadProfileAvatar();
    return () => {
      active = false;
    };
  }, [enabled, getToken, userId]);

  const setAvatarUrl = useCallback((avatarUrl: string | null) => {
    if (!userId) return;
    setState({ userId, avatarUrl });
  }, [userId]);

  return {
    avatarUrl: state?.userId === userId ? state.avatarUrl : null,
    setAvatarUrl,
  };
}
