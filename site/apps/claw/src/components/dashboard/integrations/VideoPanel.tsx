"use client";

import { Video } from "lucide-react";

interface VideoPanelProps {
  onClose: () => void;
}

export function VideoPanel({ onClose }: VideoPanelProps) {
  return (
    <div className="space-y-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Video className="h-6 w-6 text-primary" />
      </div>

      <p className="text-sm text-text-secondary">
        Your agent can generate videos from text, images, and audio using the Renders API.
        Available through agent tools and API workflows &mdash; nothing to set up.
      </p>

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-foreground">What it can do</h4>
        <ul className="space-y-1.5 text-sm text-text-secondary">
          <li className="flex items-start gap-2">
            <span className="mt-1 text-primary">&#8226;</span>
            Generate video from text prompts (Wan 2.2 14B)
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 text-primary">&#8226;</span>
            Animate a still image into video (Wan 2.2 Animate)
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 text-primary">&#8226;</span>
            Create lip-sync talking head videos (HuMo)
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 text-primary">&#8226;</span>
            Audio-driven video generation (Wan 2.2 S2V)
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 text-primary">&#8226;</span>
            Morph between two frames as video (Wan 2.2 First/Last Frame)
          </li>
        </ul>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-foreground">Available methods</h4>
        <div className="flex flex-wrap gap-1.5">
          {["textToVideo()", "imageToVideo()", "speakingVideo()", "speakingVideoWan()", "firstLastFrameVideo()"].map((method) => (
            <span
              key={method}
              className="rounded bg-surface-low px-2 py-1 font-mono text-xs text-text-secondary"
            >
              {method}
            </span>
          ))}
        </div>
      </div>

      <div className="glass-card p-3 text-xs text-text-tertiary">
        <p>
          Try it: ask your agent to{" "}
          <span className="text-text-secondary">&quot;create a video of waves crashing on a beach&quot;</span>
        </p>
      </div>

      <div className="flex justify-end pt-2">
        <button onClick={onClose} className="btn-primary px-4 py-2 rounded-lg text-sm font-medium">
          Got it
        </button>
      </div>
    </div>
  );
}
