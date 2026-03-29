"use client";

import { Eye } from "lucide-react";

interface VisionPanelProps {
  onClose: () => void;
}

export function VisionPanel({ onClose }: VisionPanelProps) {
  return (
    <div className="space-y-6">
      <div className="w-12 h-12 rounded-full bg-[var(--primary)]/10 flex items-center justify-center">
        <Eye className="w-6 h-6 text-[var(--primary)]" />
      </div>

      <p className="text-sm text-text-secondary">
        Your agent can understand images when using a vision-capable model (e.g. Kimi K2.5).
        Just attach an image in chat &mdash; nothing to set up.
      </p>

      <div className="space-y-3">
        <h4 className="text-sm font-medium text-foreground">What it can do</h4>
        <ul className="space-y-1.5 text-sm text-text-secondary">
          <li className="flex items-start gap-2">
            <span className="text-[var(--primary)] mt-1">&#8226;</span>
            Describe and analyze images in detail
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[var(--primary)] mt-1">&#8226;</span>
            Read text from screenshots and documents
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[var(--primary)] mt-1">&#8226;</span>
            Answer questions about visual content
          </li>
        </ul>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-foreground">Supported formats</h4>
        <div className="flex flex-wrap gap-1.5">
          {["png", "jpg", "webp", "gif"].map((fmt) => (
            <span
              key={fmt}
              className="px-2 py-1 bg-[var(--surface-low)] text-text-secondary rounded text-xs font-mono"
            >
              {fmt}
            </span>
          ))}
        </div>
      </div>

      <div className="glass-card p-3 text-xs text-text-tertiary">
        <p>
          Try it: attach an image and ask{" "}
          <span className="text-text-secondary">&quot;What do you see?&quot;</span>
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
