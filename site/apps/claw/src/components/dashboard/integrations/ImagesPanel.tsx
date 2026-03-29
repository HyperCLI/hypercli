"use client";

import { Image } from "lucide-react";

interface ImagesPanelProps {
  onClose: () => void;
}

export function ImagesPanel({ onClose }: ImagesPanelProps) {
  return (
    <div className="space-y-6">
      <div className="w-12 h-12 rounded-full bg-[var(--primary)]/10 flex items-center justify-center">
        <Image className="w-6 h-6 text-[var(--primary)]" />
      </div>

      <p className="text-sm text-text-secondary">
        Your agent can generate and edit images using the Renders API. Available via SDK and agent
        tool-use &mdash; nothing to set up.
      </p>

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-foreground">What it can do</h4>
        <ul className="space-y-1.5 text-sm text-text-secondary">
          <li className="flex items-start gap-2">
            <span className="text-[var(--primary)] mt-1">&#8226;</span>
            Generate images from text prompts (Qwen-Image)
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[var(--primary)] mt-1">&#8226;</span>
            Generate high-quality images (HiDream I1 Full)
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[var(--primary)] mt-1">&#8226;</span>
            Edit and transform existing images (Qwen Image Edit)
          </li>
        </ul>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-foreground">SDK methods</h4>
        <div className="flex flex-wrap gap-1.5">
          {["textToImage()", "textToImageHidream()", "imageToImage()"].map((method) => (
            <span
              key={method}
              className="px-2 py-1 bg-[var(--surface-low)] text-text-secondary rounded text-xs font-mono"
            >
              {method}
            </span>
          ))}
        </div>
      </div>

      <div className="glass-card p-3 text-xs text-text-tertiary">
        <p>
          Try it: ask your agent to{" "}
          <span className="text-text-secondary">&quot;generate an image of a sunset over mountains&quot;</span>
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
